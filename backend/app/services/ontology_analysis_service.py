"""Domain-wide semantic analysis for ontology exploration and quality review."""

from __future__ import annotations

import hashlib
from collections import defaultdict, deque
from copy import deepcopy
from pathlib import Path
from threading import RLock

from rdflib import BNode, Graph, Literal, URIRef
from rdflib.collection import Collection
from rdflib.namespace import OWL, RDF, RDFS, XSD

from app.config import ONTOLOGY_ROOT, discover_catalog, resolve_source
from app.services.ontology_graph_service import OntologyGraphService


# Kept local to avoid exposing parser implementation details as a public API.
BUILTIN_NAMESPACES = (str(RDF), str(RDFS), str(OWL), str(XSD))


def _local_name(value: URIRef | str) -> str:
    text = str(value)
    marker = max(text.rfind("#"), text.rfind("/"))
    return text[marker + 1 :] if marker >= 0 else text


def _issue_id(code: str, subject: str, related: str = "") -> str:
    digest = hashlib.sha1(f"{code}|{subject}|{related}".encode("utf-8")).hexdigest()[:16]
    return f"quality:{digest}"


class OntologyAnalysisService:
    """Build cached cross-module graphs and deterministic analysis responses."""

    def __init__(self, graph_service: OntologyGraphService | None = None) -> None:
        self._graphs = graph_service or OntologyGraphService()
        self._cache: dict[str, tuple[tuple, dict]] = {}
        self._lock = RLock()

    def semantic_graph(self, domain: str, refresh: bool = False) -> dict:
        signature = self._signature(domain)
        with self._lock:
            cached = self._cache.get(domain)
            if not refresh and cached and cached[0] == signature:
                return deepcopy(cached[1])

        payload = self._build_semantic_graph(domain)
        with self._lock:
            self._cache[domain] = (signature, payload)
        return deepcopy(payload)

    def hierarchy(self, domain: str, refresh: bool = False) -> dict:
        payload = self.semantic_graph(domain, refresh=refresh)
        nodes = payload["nodes"]
        subclass_edges = [
            edge for edge in payload["edges"] if edge["edge_type"] == "subClassOf"
        ]
        parents: dict[str, list[str]] = defaultdict(list)
        children: dict[str, list[str]] = defaultdict(list)
        for edge in subclass_edges:
            parents[edge["source"]].append(edge["target"])
            children[edge["target"]].append(edge["source"])

        entries = []
        for node in nodes:
            entries.append(
                {
                    "id": node["id"],
                    "label": node.get("label") or node["local_name"],
                    "qname": node["qname"],
                    "module": node.get("module", "external"),
                    "modules": node.get("modules", []),
                    "parent_ids": sorted(set(parents[node["id"]])),
                    "child_ids": sorted(set(children[node["id"]])),
                    "property_count": len(node.get("datatype_properties", []))
                    + len(node.get("object_properties", [])),
                }
            )
        root_ids = sorted(item["id"] for item in entries if not item["parent_ids"])
        return {
            "domain": domain,
            "root_ids": root_ids,
            "entries": sorted(entries, key=lambda item: (item["label"], item["id"])),
            "total_roots": len(root_ids),
            "total_entries": len(entries),
        }

    def neighborhood(
        self,
        domain: str,
        entity_uri: str,
        depth: int = 1,
        direction: str = "both",
    ) -> dict:
        if depth not in {1, 2}:
            raise ValueError("Neighborhood depth must be 1 or 2")
        if direction not in {"incoming", "outgoing", "both"}:
            raise ValueError("Invalid neighborhood direction")

        payload = self.semantic_graph(domain)
        node_map = {node["id"]: node for node in payload["nodes"]}
        if entity_uri not in node_map:
            raise FileNotFoundError(entity_uri)

        distances = {entity_uri: 0}
        queue: deque[str] = deque([entity_uri])
        selected_edges: dict[str, dict] = {}
        while queue:
            current = queue.popleft()
            current_depth = distances[current]
            if current_depth >= depth:
                continue
            for edge in payload["edges"]:
                neighbor: str | None = None
                if direction in {"outgoing", "both"} and edge["source"] == current:
                    neighbor = edge["target"]
                if direction in {"incoming", "both"} and edge["target"] == current:
                    neighbor = edge["source"]
                if neighbor is None:
                    continue
                selected_edges[edge["id"]] = edge
                if neighbor not in distances:
                    distances[neighbor] = current_depth + 1
                    queue.append(neighbor)

        nodes = []
        for node_id, distance in distances.items():
            node = deepcopy(node_map[node_id])
            node["distance"] = distance
            nodes.append(node)
        return {
            "domain": domain,
            "center": entity_uri,
            "depth": depth,
            "direction": direction,
            "nodes": sorted(nodes, key=lambda item: (item["distance"], item["id"])),
            "edges": sorted(selected_edges.values(), key=lambda item: item["id"]),
        }

    def shortest_path(
        self,
        domain: str,
        source_uri: str,
        target_uri: str,
        directed: bool = False,
    ) -> dict:
        payload = self.semantic_graph(domain)
        node_map = {node["id"]: node for node in payload["nodes"]}
        if source_uri not in node_map or target_uri not in node_map:
            raise FileNotFoundError("Path endpoint not found")
        if source_uri == target_uri:
            return {
                "domain": domain,
                "found": True,
                "directed": directed,
                "hops": 0,
                "node_ids": [source_uri],
                "edge_ids": [],
                "nodes": [node_map[source_uri]],
                "edges": [],
            }

        adjacency: dict[str, list[tuple[str, dict]]] = defaultdict(list)
        for edge in payload["edges"]:
            adjacency[edge["source"]].append((edge["target"], edge))
            if not directed:
                adjacency[edge["target"]].append((edge["source"], edge))

        previous: dict[str, tuple[str, dict]] = {}
        visited = {source_uri}
        queue: deque[str] = deque([source_uri])
        while queue and target_uri not in visited:
            current = queue.popleft()
            for neighbor, edge in adjacency[current]:
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                previous[neighbor] = (current, edge)
                queue.append(neighbor)
                if neighbor == target_uri:
                    break

        if target_uri not in visited:
            return {
                "domain": domain,
                "found": False,
                "directed": directed,
                "hops": None,
                "node_ids": [],
                "edge_ids": [],
                "nodes": [],
                "edges": [],
            }

        node_ids = [target_uri]
        path_edges: list[dict] = []
        current = target_uri
        while current != source_uri:
            parent, edge = previous[current]
            path_edges.append(edge)
            node_ids.append(parent)
            current = parent
        node_ids.reverse()
        path_edges.reverse()
        return {
            "domain": domain,
            "found": True,
            "directed": directed,
            "hops": len(path_edges),
            "node_ids": node_ids,
            "edge_ids": [edge["id"] for edge in path_edges],
            "nodes": [node_map[node_id] for node_id in node_ids],
            "edges": path_edges,
        }

    def impact(self, domain: str, entity_uri: str) -> dict:
        payload = self.semantic_graph(domain)
        node_map = {node["id"]: node for node in payload["nodes"]}
        if entity_uri not in node_map:
            raise FileNotFoundError(entity_uri)
        node = node_map[entity_uri]
        graph, entity_modules, property_modules = self._load_domain_graph(domain)
        entity = URIRef(entity_uri)

        references: list[dict] = []

        def add(kind: str, subject: URIRef, predicate: URIRef, obj: URIRef) -> None:
            subject_modules = property_modules.get(subject) or entity_modules.get(subject) or {"external"}
            object_modules = property_modules.get(obj) or entity_modules.get(obj) or {"external"}
            module = self._first_module(subject_modules)
            references.append(
                {
                    "kind": kind,
                    "subject": str(subject),
                    "predicate": str(predicate),
                    "object": str(obj),
                    "module": module,
                    "cross_module": bool(
                        subject_modules
                        and object_modules
                        and set(subject_modules).isdisjoint(set(object_modules))
                        and "external" not in subject_modules
                        and "external" not in object_modules
                    ),
                }
            )

        for subject, predicate in graph.subject_predicates(entity):
            if isinstance(subject, URIRef) and isinstance(predicate, URIRef):
                kind = {
                    str(RDFS.subClassOf): "subclass",
                    str(RDFS.domain): "domain",
                    str(RDFS.range): "range",
                    str(OWL.inverseOf): "inverse",
                }.get(str(predicate), "reference")
                add(kind, subject, predicate, entity)
        for predicate, obj in graph.predicate_objects(entity):
            if not isinstance(predicate, URIRef) or not isinstance(obj, URIRef):
                continue
            kind = {
                str(RDFS.subClassOf): "superclass",
                str(OWL.inverseOf): "inverse",
            }.get(str(predicate))
            if kind:
                add(kind, entity, predicate, obj)

        for head in graph.objects(entity, OWL.hasKey):
            if not isinstance(head, BNode):
                continue
            try:
                for key_property in Collection(graph, head):
                    if isinstance(key_property, URIRef):
                        add("hasKey", entity, OWL.hasKey, key_property)
            except Exception:
                continue

        for class_uri in graph.subjects(RDF.type, OWL.Class):
            if not isinstance(class_uri, URIRef):
                continue
            for head in graph.objects(class_uri, OWL.hasKey):
                if isinstance(head, BNode):
                    try:
                        if entity in Collection(graph, head):
                            add("hasKey", class_uri, OWL.hasKey, entity)
                    except Exception:
                        continue

        unique = {
            (item["kind"], item["subject"], item["predicate"], item["object"]): item
            for item in references
        }
        references = sorted(
            unique.values(), key=lambda item: (item["kind"], item["module"], item["subject"])
        )
        by_kind: dict[str, int] = defaultdict(int)
        for item in references:
            by_kind[item["kind"]] += 1
        cross_module = sum(1 for item in references if item["cross_module"])
        return {
            "domain": domain,
            "entity": {
                "id": node["id"],
                "label": node.get("label") or node["local_name"],
                "qname": node["qname"],
                "module": node.get("module", "external"),
            },
            "summary": {
                "total_references": len(references),
                "cross_module_references": cross_module,
                "by_kind": dict(sorted(by_kind.items())),
                "risk": "high" if cross_module or len(references) >= 8 else "medium" if references else "low",
            },
            "references": references,
        }

    def quality(self, domain: str, refresh: bool = False) -> dict:
        payload = self.semantic_graph(domain, refresh=refresh)
        graph, entity_modules, property_modules = self._load_domain_graph(domain)
        classes = {
            value for value in graph.subjects(RDF.type, OWL.Class) if isinstance(value, URIRef)
        }
        datatype_properties = {
            value
            for value in graph.subjects(RDF.type, OWL.DatatypeProperty)
            if isinstance(value, URIRef)
        }
        object_properties = {
            value
            for value in graph.subjects(RDF.type, OWL.ObjectProperty)
            if isinstance(value, URIRef)
        }
        entities = classes | datatype_properties | object_properties
        issues: list[dict] = []

        def add(
            severity: str,
            code: str,
            message: str,
            subject: URIRef | str,
            related: URIRef | str | None = None,
        ) -> None:
            subject_text = str(subject)
            related_text = str(related) if related is not None else ""
            modules = entity_modules.get(URIRef(subject_text)) or property_modules.get(
                URIRef(subject_text)
            )
            focus_entity = subject_text
            if URIRef(subject_text) not in classes:
                focus_entity = next(
                    (
                        str(value)
                        for value in graph.objects(URIRef(subject_text), RDFS.domain)
                        if isinstance(value, URIRef) and value in classes
                    ),
                    subject_text,
                )
            issues.append(
                {
                    "id": _issue_id(code, subject_text, related_text),
                    "severity": severity,
                    "code": code,
                    "message": message,
                    "subject": subject_text,
                    "related": related_text or None,
                    "module": self._first_module(modules or {"external"}),
                    "focus_entity": focus_entity,
                }
            )

        labels: dict[str, list[URIRef]] = defaultdict(list)
        for entity in sorted(entities, key=str):
            values = [value for value in graph.objects(entity, RDFS.label) if isinstance(value, Literal)]
            if not values:
                add("warning", "MISSING_LABEL", "实体没有声明 rdfs:label。", entity)
            else:
                for value in values:
                    labels[str(value).strip().casefold()].append(entity)
            has_description = any(
                isinstance(value, Literal)
                and _local_name(predicate).casefold()
                in {"comment", "description", "classdescription"}
                for predicate, value in graph.predicate_objects(entity)
            )
            if not has_description:
                add("info", "MISSING_COMMENT", "实体没有可识别的业务描述。", entity)

        for label, subjects in labels.items():
            unique_subjects = sorted(set(subjects), key=str)
            if label and len(unique_subjects) > 1:
                for subject in unique_subjects:
                    related = next(item for item in unique_subjects if item != subject)
                    add("warning", "DUPLICATE_LABEL", "多个实体使用了相同标签。", subject, related)

        properties = datatype_properties | object_properties
        for prop in sorted(properties, key=str):
            domains = [value for value in graph.objects(prop, RDFS.domain) if isinstance(value, URIRef)]
            ranges = [value for value in graph.objects(prop, RDFS.range) if isinstance(value, URIRef)]
            if not domains:
                add("warning", "PROPERTY_WITHOUT_DOMAIN", "属性没有声明 rdfs:domain。", prop)
            if not ranges:
                add("warning", "PROPERTY_WITHOUT_RANGE", "属性没有声明 rdfs:range。", prop)
            for domain_value in domains:
                if domain_value not in classes and not self._is_builtin(domain_value):
                    add("error", "UNDECLARED_DOMAIN", "属性 domain 指向未声明的类。", prop, domain_value)
            if prop in object_properties:
                for range_value in ranges:
                    if range_value not in classes and not self._is_builtin(range_value):
                        add("error", "UNDECLARED_OBJECT_RANGE", "对象属性 range 指向未声明的类。", prop, range_value)

        for child, parent in graph.subject_objects(RDFS.subClassOf):
            if not isinstance(child, URIRef) or not isinstance(parent, URIRef):
                continue
            if child not in classes:
                add("error", "UNDECLARED_SUBCLASS", "继承关系的子类未声明为 owl:Class。", child, parent)
            if parent not in classes and not self._is_builtin(parent):
                add("error", "UNDECLARED_SUPERCLASS", "继承关系的父类未声明为 owl:Class。", child, parent)

        for cycle in self._inheritance_cycles(graph, classes):
            cycle_text = " → ".join(_local_name(item) for item in cycle)
            for subject in cycle:
                add("error", "CYCLIC_INHERITANCE", f"检测到循环继承：{cycle_text}", subject)

        for prop, inverse in graph.subject_objects(OWL.inverseOf):
            if not isinstance(prop, URIRef) or not isinstance(inverse, URIRef):
                continue
            if (inverse, OWL.inverseOf, prop) not in graph:
                add("warning", "INVERSE_NOT_SYMMETRIC", "inverseOf 缺少显式反向声明。", prop, inverse)

        degree: dict[str, int] = defaultdict(int)
        for edge in payload["edges"]:
            degree[edge["source"]] += 1
            degree[edge["target"]] += 1
        for node in payload["nodes"]:
            if (
                degree[node["id"]] == 0
                and not node.get("datatype_properties")
                and not node.get("object_properties")
                and not node.get("has_key")
            ):
                add("info", "ISOLATED_CLASS", "类没有关系、属性或唯一键引用。", node["id"])

        issues = list({item["id"]: item for item in issues}.values())
        severity_order = {"error": 0, "warning": 1, "info": 2}
        issues.sort(key=lambda item: (severity_order[item["severity"]], item["code"], item["subject"]))
        counts = {
            severity: sum(1 for issue in issues if issue["severity"] == severity)
            for severity in ("error", "warning", "info")
        }
        score = max(
            0,
            round(
                100
                - min(60, counts["error"] * 10)
                - min(25, counts["warning"] * 0.25)
                - min(10, counts["info"] * 0.05)
            ),
        )
        return {
            "domain": domain,
            "summary": {
                **counts,
                "total": len(issues),
                "score": score,
                "passed": counts["error"] == 0,
            },
            "issues": issues,
        }

    def _build_semantic_graph(self, domain: str) -> dict:
        catalog = self._domain_catalog(domain)
        payload = self._graphs.get_graph(domain, "all", refresh=True)
        entity_modules: dict[URIRef, set[str]] = defaultdict(set)
        property_modules: dict[URIRef, set[str]] = defaultdict(set)

        for module in catalog["modules"]:
            if module["id"] == "all":
                continue
            source = resolve_source(domain, module["id"])
            part = Graph()
            part.parse(source.path, format="turtle", publicID=source.path.as_uri())
            for entity in part.subjects(RDF.type, OWL.Class):
                if isinstance(entity, URIRef):
                    entity_modules[entity].add(module["id"])
            for property_type in (OWL.DatatypeProperty, OWL.ObjectProperty):
                for prop in part.subjects(RDF.type, property_type):
                    if isinstance(prop, URIRef):
                        property_modules[prop].add(module["id"])

            if module.get("custom"):
                custom_payload = self._graphs.get_graph(domain, module["id"], refresh=True)
                payload = self._merge_graph_payloads(payload, custom_payload)

        module_counts: dict[str, int] = defaultdict(int)
        for node in payload["nodes"]:
            modules = sorted(entity_modules.get(URIRef(node["id"]), set()))
            node["modules"] = modules
            node["module"] = modules[0] if modules else "external"
            module_counts[node["module"]] += 1

        node_modules = {node["id"]: set(node["modules"]) for node in payload["nodes"]}
        cross_module_edges = 0
        for edge in payload["edges"]:
            source_modules = node_modules.get(edge["source"], set())
            target_modules = node_modules.get(edge["target"], set())
            predicate_modules = property_modules.get(URIRef(edge.get("predicate") or ""), set())
            edge["module"] = self._first_module(predicate_modules or source_modules or {"external"})
            edge["source_modules"] = sorted(source_modules)
            edge["target_modules"] = sorted(target_modules)
            edge["cross_module"] = bool(
                source_modules and target_modules and source_modules.isdisjoint(target_modules)
            )
            if edge["cross_module"]:
                cross_module_edges += 1

        payload["meta"].update(
            {
                "module": "domain",
                "analysis_mode": "cross-module",
                "module_counts": dict(sorted(module_counts.items())),
                "total_cross_module_edges": cross_module_edges,
                "recommended_render_mode": (
                    "neighborhood"
                    if len(payload["nodes"]) > 3000
                    else "filtered"
                    if len(payload["nodes"]) > 500
                    else "full"
                ),
            }
        )
        return payload

    def _load_domain_graph(
        self, domain: str
    ) -> tuple[Graph, dict[URIRef, set[str]], dict[URIRef, set[str]]]:
        catalog = self._domain_catalog(domain)
        graph = Graph()
        entity_modules: dict[URIRef, set[str]] = defaultdict(set)
        property_modules: dict[URIRef, set[str]] = defaultdict(set)
        for module in catalog["modules"]:
            if module["id"] == "all":
                continue
            source = resolve_source(domain, module["id"])
            part = Graph()
            part.parse(source.path, format="turtle", publicID=source.path.as_uri())
            for prefix, namespace in part.namespaces():
                graph.bind(prefix, namespace, replace=False)
            for triple in part:
                graph.add(triple)
            for entity in part.subjects(RDF.type, OWL.Class):
                if isinstance(entity, URIRef):
                    entity_modules[entity].add(module["id"])
            for property_type in (OWL.DatatypeProperty, OWL.ObjectProperty):
                for prop in part.subjects(RDF.type, property_type):
                    if isinstance(prop, URIRef):
                        property_modules[prop].add(module["id"])
        return graph, entity_modules, property_modules

    @staticmethod
    def _merge_graph_payloads(primary: dict, extra: dict) -> dict:
        merged = deepcopy(primary)
        merged["nodes"] = list(
            {node["id"]: node for node in [*merged["nodes"], *extra["nodes"]]}.values()
        )
        merged["edges"] = list(
            {edge["id"]: edge for edge in [*merged["edges"], *extra["edges"]]}.values()
        )
        merged["warnings"] = [*merged["warnings"], *extra["warnings"]]
        merged["meta"]["total_nodes"] = len(merged["nodes"])
        merged["meta"]["total_edges"] = len(merged["edges"])
        merged["meta"]["total_classes"] = len(merged["nodes"])
        return merged

    @staticmethod
    def _inheritance_cycles(graph: Graph, classes: set[URIRef]) -> list[list[URIRef]]:
        adjacency: dict[URIRef, set[URIRef]] = defaultdict(set)
        for child, parent in graph.subject_objects(RDFS.subClassOf):
            if isinstance(child, URIRef) and isinstance(parent, URIRef):
                if child in classes and parent in classes:
                    adjacency[child].add(parent)

        cycles: list[list[URIRef]] = []
        visiting: set[URIRef] = set()
        visited: set[URIRef] = set()
        stack: list[URIRef] = []

        def visit(node: URIRef) -> None:
            if node in visited:
                return
            visiting.add(node)
            stack.append(node)
            for parent in adjacency.get(node, set()):
                if parent in visiting:
                    index = stack.index(parent)
                    cycle = stack[index:].copy()
                    key = tuple(sorted(str(item) for item in cycle))
                    if not any(tuple(sorted(str(item) for item in found)) == key for found in cycles):
                        cycles.append(cycle)
                else:
                    visit(parent)
            stack.pop()
            visiting.discard(node)
            visited.add(node)

        for class_uri in sorted(classes, key=str):
            visit(class_uri)
        return cycles

    def _domain_catalog(self, domain: str) -> dict:
        catalog = discover_catalog()
        selected = next((item for item in catalog["domains"] if item["id"] == domain), None)
        if selected is None:
            raise FileNotFoundError(domain)
        return selected

    @staticmethod
    def _first_module(modules: set[str]) -> str:
        return sorted(modules)[0] if modules else "external"

    @staticmethod
    def _is_builtin(value: URIRef) -> bool:
        return str(value).startswith(BUILTIN_NAMESPACES)

    @staticmethod
    def _signature(domain: str) -> tuple:
        domain_root = (ONTOLOGY_ROOT / domain).resolve()
        try:
            domain_root.relative_to(ONTOLOGY_ROOT.resolve())
        except ValueError as exc:
            raise ValueError("Invalid domain") from exc
        if not domain_root.is_dir():
            raise FileNotFoundError(domain)
        return tuple(
            (path.relative_to(domain_root).as_posix(), path.stat().st_mtime_ns, path.stat().st_size)
            for path in sorted(domain_root.rglob("*.ttl"))
            if path.is_file()
        )
