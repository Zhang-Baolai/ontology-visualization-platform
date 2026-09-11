"""Parse local Turtle ontologies into the frontend graph contract."""

from __future__ import annotations

import hashlib
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

from rdflib import BNode, Graph, Literal, URIRef
from rdflib.collection import Collection
from rdflib.namespace import OWL, RDF, RDFS, SKOS, XSD

from app.config import OntologySource, to_display_path


class OntologyParseError(RuntimeError):
    """Raised when a local ontology cannot be parsed."""


BUILTIN_NAMESPACES = (
    str(RDF),
    str(RDFS),
    str(OWL),
    str(XSD),
)


def _local_name(value: URIRef | str) -> str:
    text = str(value)
    marker = max(text.rfind("#"), text.rfind("/"))
    return text[marker + 1 :] if marker >= 0 else text


def _literal_score(value: Literal) -> tuple[int, str]:
    language = (value.language or "").lower()
    rank = 0 if language.startswith("zh") else 1 if not language else 2
    return rank, str(value)


def _preferred_literal(graph: Graph, subject: URIRef, predicate: URIRef) -> str | None:
    values = [value for value in graph.objects(subject, predicate) if isinstance(value, Literal)]
    if not values:
        return None
    return str(sorted(values, key=_literal_score)[0])


def _uri_values(graph: Graph, subject: URIRef, predicate: URIRef) -> list[str]:
    return sorted(
        str(value)
        for value in graph.objects(subject, predicate)
        if isinstance(value, URIRef)
    )


class OntologyParser:
    """Build deterministic class nodes, semantic edges, metadata and warnings."""

    def parse(self, source: OntologySource) -> dict:
        graph, primary_graph, source_files, load_warnings = self._load_graph(source)
        warnings: list[dict] = list(load_warnings)

        declared_classes = {
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

        referenced_classes: set[URIRef] = set()
        for child, parent in graph.subject_objects(RDFS.subClassOf):
            if isinstance(child, URIRef):
                referenced_classes.add(child)
            if isinstance(parent, URIRef) and not self._is_builtin(parent):
                referenced_classes.add(parent)
        for prop in datatype_properties | object_properties:
            for domain in graph.objects(prop, RDFS.domain):
                if isinstance(domain, URIRef) and not self._is_builtin(domain):
                    referenced_classes.add(domain)
        for prop in object_properties:
            for target in graph.objects(prop, RDFS.range):
                if isinstance(target, URIRef) and not self._is_builtin(target):
                    referenced_classes.add(target)

        all_classes = declared_classes | referenced_classes
        for class_uri in sorted(referenced_classes - declared_classes, key=str):
            warnings.append(
                self._warning(
                    "UNDECLARED_CLASS_REFERENCE",
                    "关系引用了未显式声明为 owl:Class 的实体，已作为类节点展示。",
                    class_uri,
                )
            )

        datatype_by_domain: dict[URIRef, list[dict]] = defaultdict(list)
        for prop in sorted(datatype_properties, key=str):
            domains = [value for value in graph.objects(prop, RDFS.domain) if isinstance(value, URIRef)]
            ranges = _uri_values(graph, prop, RDFS.range)
            if not domains:
                warnings.append(
                    self._warning(
                        "DATATYPE_PROPERTY_WITHOUT_DOMAIN",
                        "数据属性没有声明 rdfs:domain，未挂载到具体类。",
                        prop,
                    )
                )
            if not ranges:
                warnings.append(
                    self._warning(
                        "DATATYPE_PROPERTY_WITHOUT_RANGE",
                        "数据属性没有声明 rdfs:range。",
                        prop,
                    )
                )
            info = self._datatype_property(graph, prop)
            for domain in domains:
                if domain in all_classes:
                    datatype_by_domain[domain].append(info)

        object_by_domain: dict[URIRef, list[dict]] = defaultdict(list)
        for prop in sorted(object_properties, key=str):
            domains = [value for value in graph.objects(prop, RDFS.domain) if isinstance(value, URIRef)]
            ranges = [value for value in graph.objects(prop, RDFS.range) if isinstance(value, URIRef)]
            if not domains:
                warnings.append(
                    self._warning(
                        "OBJECT_PROPERTY_WITHOUT_DOMAIN",
                        "对象属性没有声明 rdfs:domain，无法生成关系起点。",
                        prop,
                    )
                )
            if not ranges:
                warnings.append(
                    self._warning(
                        "OBJECT_PROPERTY_WITHOUT_RANGE",
                        "对象属性没有声明 rdfs:range，无法生成关系终点。",
                        prop,
                    )
                )
            info = self._object_property(graph, prop)
            for domain in domains:
                if domain in all_classes:
                    object_by_domain[domain].append(info)

        nodes = [
            self._class_node(
                graph,
                class_uri,
                datatype_by_domain.get(class_uri, []),
                object_by_domain.get(class_uri, []),
            )
            for class_uri in all_classes
        ]
        nodes.sort(key=lambda item: (item.get("label") or item["local_name"], item["id"]))

        subclass_edges, parents = self._subclass_edges(graph, all_classes, warnings)
        object_edges = self._object_edges(graph, object_properties, all_classes)
        inferred_edges = self._inferred_object_edges(
            graph,
            object_properties,
            all_classes,
            parents,
            object_edges,
        )
        edges = sorted(
            [*subclass_edges, *object_edges, *inferred_edges],
            key=lambda item: (item["edge_type"], item["source"], item["target"], item["id"]),
        )

        ontology_subject = next(
            (
                value
                for value in primary_graph.subjects(RDF.type, OWL.Ontology)
                if isinstance(value, URIRef)
            ),
            None,
        )
        source_file = to_display_path(source.path)
        declared_edges = sum(1 for edge in edges if edge["declared"])
        inferred_count = sum(1 for edge in edges if edge["inferred"])

        return {
            "meta": {
                "domain": source.domain,
                "module": source.module,
                "source_file": source_file,
                "source_files": [to_display_path(path) for path in source_files],
                "ontology_iri": str(ontology_subject) if ontology_subject else None,
                "ontology_label": (
                    _preferred_literal(graph, ontology_subject, RDFS.label)
                    if ontology_subject
                    else source.label
                ),
                "ontology_comment": (
                    _preferred_literal(graph, ontology_subject, RDFS.comment)
                    if ontology_subject
                    else None
                ),
                "total_classes": len(all_classes),
                "total_datatype_properties": len(datatype_properties),
                "total_object_properties": len(object_properties),
                "total_nodes": len(nodes),
                "total_edges": len(edges),
                "total_declared_edges": declared_edges,
                "total_inferred_edges": inferred_count,
                "total_warnings": len(warnings),
                "parsed_at": datetime.now(timezone.utc).isoformat(),
            },
            "nodes": nodes,
            "edges": edges,
            "warnings": warnings,
        }

    def _load_graph(
        self, source: OntologySource
    ) -> tuple[Graph, Graph, list[Path], list[dict]]:
        aggregate = Graph()
        primary_graph = Graph()
        source_files: list[Path] = []
        warnings: list[dict] = []
        queue: deque[Path] = deque([source.path])
        visited: set[Path] = set()

        while queue:
            path = queue.popleft().resolve()
            if path in visited:
                continue
            visited.add(path)
            try:
                part = Graph()
                part.parse(path, format="turtle", publicID=path.as_uri())
            except Exception as exc:  # rdflib raises several parser-specific types
                raise OntologyParseError(f"Failed to parse {path.name}: {exc}") from exc

            if not source_files:
                primary_graph = part
            source_files.append(path)
            for prefix, namespace in part.namespaces():
                aggregate.bind(prefix, namespace, replace=False)
            for triple in part:
                aggregate.add(triple)

            if not source.include_imports:
                continue
            for imported in part.objects(None, OWL.imports):
                if not isinstance(imported, URIRef):
                    warnings.append(
                        self._warning(
                            "IMPORT_SKIPPED",
                            "忽略了不是 URI 的 owl:imports 声明。",
                            imported,
                        )
                    )
                    continue
                import_path = self._resolve_import(imported, path, source.domain_root)
                if import_path is None:
                    warnings.append(
                        self._warning(
                            "IMPORT_SKIPPED",
                            "仅允许加载当前领域目录内的本地 owl:imports。",
                            imported,
                        )
                    )
                elif not import_path.is_file():
                    warnings.append(
                        self._warning(
                            "IMPORT_NOT_FOUND",
                            "owl:imports 指向的本地文件不存在。",
                            imported,
                        )
                    )
                else:
                    queue.append(import_path)

        return aggregate, primary_graph, source_files, warnings

    @staticmethod
    def _resolve_import(imported: URIRef, current: Path, domain_root: Path) -> Path | None:
        parsed = urlparse(str(imported))
        if parsed.scheme == "file":
            if parsed.netloc not in {"", "localhost"}:
                return None
            candidate = Path(url2pathname(parsed.path))
        elif parsed.scheme:
            return None
        else:
            candidate = current.parent / unquote(parsed.path)
        candidate = candidate.resolve()
        try:
            candidate.relative_to(domain_root.resolve())
        except ValueError:
            return None
        return candidate

    @staticmethod
    def _is_builtin(value: URIRef) -> bool:
        return str(value).startswith(BUILTIN_NAMESPACES)

    @staticmethod
    def _warning(code: str, message: str, subject: object) -> dict:
        return {"code": code, "message": message, "subject": str(subject)}

    @staticmethod
    def _qname(graph: Graph, value: URIRef) -> str:
        try:
            return graph.namespace_manager.normalizeUri(value).strip("<>")
        except Exception:
            return _local_name(value)

    def _class_description(self, graph: Graph, class_uri: URIRef) -> str | None:
        for predicate, value in graph.predicate_objects(class_uri):
            if isinstance(value, Literal) and _local_name(predicate).lower() in {
                "classdescription",
                "description",
            }:
                return str(value)
        return None

    def _list_values(self, graph: Graph, subject: URIRef, predicate: URIRef) -> list[str]:
        output: list[str] = []
        for head in graph.objects(subject, predicate):
            if isinstance(head, URIRef):
                output.append(str(head))
                continue
            if not isinstance(head, BNode):
                continue
            try:
                output.extend(str(item) for item in Collection(graph, head) if isinstance(item, URIRef))
            except Exception:
                continue
        return sorted(set(output))

    def _class_node(
        self,
        graph: Graph,
        class_uri: URIRef,
        datatype_properties: list[dict],
        object_properties: list[dict],
    ) -> dict:
        alt_labels = sorted(
            str(value)
            for value in graph.objects(class_uri, SKOS.altLabel)
            if isinstance(value, Literal)
        )
        return {
            "id": str(class_uri),
            "local_name": _local_name(class_uri),
            "qname": self._qname(graph, class_uri),
            "type": "class",
            "label": _preferred_literal(graph, class_uri, RDFS.label),
            "comment": _preferred_literal(graph, class_uri, RDFS.comment),
            "class_description": self._class_description(graph, class_uri),
            "alt_labels": alt_labels,
            "sub_class_of": _uri_values(graph, class_uri, RDFS.subClassOf),
            "has_key": self._list_values(graph, class_uri, OWL.hasKey),
            "datatype_properties": sorted(
                datatype_properties, key=lambda item: (item.get("label") or item["local_name"])
            ),
            "object_properties": sorted(
                object_properties, key=lambda item: (item.get("label") or item["local_name"])
            ),
        }

    def _datatype_property(self, graph: Graph, prop: URIRef) -> dict:
        return {
            "uri": str(prop),
            "local_name": _local_name(prop),
            "qname": self._qname(graph, prop),
            "label": _preferred_literal(graph, prop, RDFS.label),
            "comment": _preferred_literal(graph, prop, RDFS.comment),
            "range": _uri_values(graph, prop, RDFS.range),
            "is_functional": (prop, RDF.type, OWL.FunctionalProperty) in graph,
            "sub_property_of": _uri_values(graph, prop, RDFS.subPropertyOf),
        }

    def _object_property(self, graph: Graph, prop: URIRef) -> dict:
        inverse = next(
            (value for value in graph.objects(prop, OWL.inverseOf) if isinstance(value, URIRef)),
            None,
        )
        return {
            "uri": str(prop),
            "local_name": _local_name(prop),
            "qname": self._qname(graph, prop),
            "label": _preferred_literal(graph, prop, RDFS.label),
            "comment": _preferred_literal(graph, prop, RDFS.comment),
            "range": _uri_values(graph, prop, RDFS.range),
            "sub_property_of": _uri_values(graph, prop, RDFS.subPropertyOf),
            "inverse_of": str(inverse) if inverse else None,
        }

    @staticmethod
    def _edge_id(kind: str, predicate: URIRef, source: URIRef, target: URIRef) -> str:
        digest = hashlib.sha1(
            f"{kind}|{predicate}|{source}|{target}".encode("utf-8")
        ).hexdigest()[:18]
        return f"{kind}:{digest}"

    def _subclass_edges(
        self,
        graph: Graph,
        all_classes: set[URIRef],
        warnings: list[dict],
    ) -> tuple[list[dict], dict[URIRef, set[URIRef]]]:
        edges: list[dict] = []
        parents: dict[URIRef, set[URIRef]] = defaultdict(set)
        for child in sorted(all_classes, key=str):
            for parent in graph.objects(child, RDFS.subClassOf):
                if isinstance(parent, BNode):
                    warnings.append(
                        self._warning(
                            "ANONYMOUS_SUPERCLASS_SKIPPED",
                            "匿名类限制暂不生成继承边，但原始三元组仍保留在 TTL 中。",
                            child,
                        )
                    )
                    continue
                if not isinstance(parent, URIRef) or parent not in all_classes:
                    continue
                parents[child].add(parent)
                edges.append(
                    {
                        "id": self._edge_id("subclass", RDFS.subClassOf, child, parent),
                        "source": str(child),
                        "target": str(parent),
                        "label": "is a",
                        "edge_type": "subClassOf",
                        "predicate": str(RDFS.subClassOf),
                        "inverse_of": None,
                        "sub_property_of": [],
                        "declared": True,
                        "inferred": False,
                        "inference_reason": None,
                    }
                )
        return edges, parents

    def _object_edges(
        self,
        graph: Graph,
        properties: set[URIRef],
        all_classes: set[URIRef],
    ) -> list[dict]:
        edges: list[dict] = []
        for prop in sorted(properties, key=str):
            domains = [value for value in graph.objects(prop, RDFS.domain) if value in all_classes]
            ranges = [value for value in graph.objects(prop, RDFS.range) if value in all_classes]
            inverse = next(
                (value for value in graph.objects(prop, OWL.inverseOf) if isinstance(value, URIRef)),
                None,
            )
            label = _preferred_literal(graph, prop, RDFS.label) or _local_name(prop)
            for source in domains:
                for target in ranges:
                    edges.append(
                        {
                            "id": self._edge_id("object", prop, source, target),
                            "source": str(source),
                            "target": str(target),
                            "label": label,
                            "edge_type": "objectProperty",
                            "predicate": str(prop),
                            "inverse_of": str(inverse) if inverse else None,
                            "sub_property_of": _uri_values(graph, prop, RDFS.subPropertyOf),
                            "declared": True,
                            "inferred": False,
                            "inference_reason": None,
                        }
                    )
        return edges

    def _inferred_object_edges(
        self,
        graph: Graph,
        properties: set[URIRef],
        all_classes: set[URIRef],
        direct_parents: dict[URIRef, set[URIRef]],
        declared_edges: list[dict],
    ) -> list[dict]:
        ancestors: dict[URIRef, set[URIRef]] = {}

        def collect(class_uri: URIRef, trail: set[URIRef] | None = None) -> set[URIRef]:
            if class_uri in ancestors:
                return ancestors[class_uri]
            current_trail = set() if trail is None else set(trail)
            if class_uri in current_trail:
                return set()
            current_trail.add(class_uri)
            result: set[URIRef] = set()
            for parent in direct_parents.get(class_uri, set()):
                result.add(parent)
                result.update(collect(parent, current_trail))
            ancestors[class_uri] = result
            return result

        for class_uri in all_classes:
            collect(class_uri)

        declared_keys = {
            (edge["predicate"], edge["source"], edge["target"]) for edge in declared_edges
        }
        inferred: list[dict] = []
        seen: set[tuple[str, str, str]] = set()
        for prop in sorted(properties, key=str):
            domains = {value for value in graph.objects(prop, RDFS.domain) if value in all_classes}
            ranges = {value for value in graph.objects(prop, RDFS.range) if value in all_classes}
            if not domains or not ranges:
                continue
            inverse = next(
                (value for value in graph.objects(prop, OWL.inverseOf) if isinstance(value, URIRef)),
                None,
            )
            label = _preferred_literal(graph, prop, RDFS.label) or _local_name(prop)
            for child, child_ancestors in ancestors.items():
                inherited_from = sorted(domains & child_ancestors, key=str)
                if not inherited_from:
                    continue
                for target in sorted(ranges, key=str):
                    key = (str(prop), str(child), str(target))
                    if key in declared_keys or key in seen:
                        continue
                    seen.add(key)
                    parent = inherited_from[0]
                    inferred.append(
                        {
                            "id": self._edge_id("inferred", prop, child, target),
                            "source": str(child),
                            "target": str(target),
                            "label": label,
                            "edge_type": "objectProperty",
                            "predicate": str(prop),
                            "inverse_of": str(inverse) if inverse else None,
                            "sub_property_of": _uri_values(graph, prop, RDFS.subPropertyOf),
                            "declared": False,
                            "inferred": True,
                            "inference_reason": (
                                f"{self._qname(graph, child)} 继承了 "
                                f"{self._qname(graph, parent)} 的对象属性"
                            ),
                        }
                    )
        return inferred
