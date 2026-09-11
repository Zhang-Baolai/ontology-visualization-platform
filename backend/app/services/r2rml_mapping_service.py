"""Offline R2RML parser, lineage graph builder, and quality analyzer.

This module is intentionally read-only: it discovers mapping files below the
configured ontology root, parses Turtle in memory, and never connects to a
database or executes rr:sqlQuery content.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Iterable

from rdflib import BNode, Graph, Literal, Namespace, RDF, RDFS, URIRef
from rdflib.namespace import OWL

from app.config import ONTOLOGY_ROOT, SAFE_KEY


RR = Namespace("http://www.w3.org/ns/r2rml#")
OBDA = Namespace("https://w3id.org/obda/vocabulary#")
XSD = Namespace("http://www.w3.org/2001/XMLSchema#")


def _text(value: object | None) -> str | None:
    return str(value) if value is not None else None


def _local_name(value: str | None) -> str:
    if not value:
        return ""
    return re.split(r"[#/]", value.rstrip("#/"))[-1]


def _short_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


class R2RMLMappingService:
    """Build stable JSON models for the R2RML mapping workbench."""

    def __init__(self, ontology_root: Path | None = None) -> None:
        self.root = (ontology_root or ONTOLOGY_ROOT).resolve()
        self._cache: dict[tuple[str | None, bool], tuple[tuple, dict]] = {}
        self._lock = RLock()

    def _mapping_files(self) -> list[Path]:
        if not self.root.is_dir():
            return []
        discovered: set[Path] = set()
        for domain_dir in self.root.iterdir():
            if not domain_dir.is_dir() or not SAFE_KEY.fullmatch(domain_dir.name):
                continue
            mapping_root = domain_dir / "mappings"
            if not mapping_root.is_dir():
                continue
            for path in mapping_root.rglob("*.ttl"):
                resolved = path.resolve()
                try:
                    resolved.relative_to(mapping_root.resolve())
                except ValueError:
                    continue
                if any(part.startswith(".") for part in path.relative_to(mapping_root).parts):
                    continue
                discovered.add(resolved)
        return sorted(discovered, key=lambda item: item.relative_to(self.root).as_posix())

    def _signature(self, files: Iterable[Path]) -> tuple:
        values: list[tuple[str, int, int]] = []
        for path in files:
            stat = path.stat()
            values.append((path.as_posix(), stat.st_mtime_ns, stat.st_size))
        for path in sorted(self.root.rglob("*.ttl")) if self.root.is_dir() else []:
            if "mappings" in path.parts or any(part.startswith(".") for part in path.parts):
                continue
            stat = path.stat()
            values.append((path.as_posix(), stat.st_mtime_ns, stat.st_size))
        return tuple(values)

    def _relative(self, path: Path) -> str:
        return f"ontologies/{path.relative_to(self.root).as_posix()}"

    def _file_descriptor(self, path: Path) -> dict:
        relative = path.relative_to(self.root)
        raw = path.read_bytes()
        return {
            "id": _short_hash(relative.as_posix()),
            "domain": relative.parts[0],
            "path": self._relative(path),
            "name": path.name,
            "size_bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "draft": "draft" in {part.lower() for part in relative.parts},
        }

    def catalog(self, refresh: bool = False) -> dict:
        files = self._mapping_files()
        descriptors = [self._file_descriptor(path) for path in files]
        domains: list[dict] = []
        for domain, grouped in _group_by(descriptors, "domain").items():
            domains.append(
                {
                    "id": domain,
                    "label": "Cloud Demo" if domain == "cloud-demo" else "Service Demo" if domain == "service-demo" else domain,
                    "files": grouped,
                    "formal_files": sum(not item["draft"] for item in grouped),
                    "draft_files": sum(item["draft"] for item in grouped),
                }
            )
        return {
            "root": "ontologies",
            "files": descriptors,
            "domains": domains,
            "total_files": len(descriptors),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    def analysis(
        self,
        domain: str | None = None,
        include_drafts: bool = False,
        refresh: bool = False,
    ) -> dict:
        if domain and not SAFE_KEY.fullmatch(domain):
            raise ValueError(f"Invalid domain: {domain!r}")
        files = [
            path
            for path in self._mapping_files()
            if (not domain or path.relative_to(self.root).parts[0] == domain)
            and (include_drafts or "draft" not in {part.lower() for part in path.relative_to(self.root).parts})
        ]
        if not files:
            label = f" for domain {domain!r}" if domain else ""
            raise FileNotFoundError(f"No R2RML mapping files found{label}")

        cache_key = (domain, include_drafts)
        signature = self._signature(files)
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached and cached[0] == signature and not refresh:
                return cached[1]

        parsed_files = [self._parse_file(path) for path in files]
        payload = self._build_analysis(parsed_files, domain, include_drafts)
        with self._lock:
            self._cache[cache_key] = (signature, payload)
        return payload

    def _qname(self, graph: Graph, value: object | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, URIRef):
            try:
                return graph.namespace_manager.normalizeUri(value)
            except Exception:
                return str(value)
        return str(value)

    def _term_map(self, graph: Graph, node: object | None) -> dict:
        if node is None:
            return {
                "kind": "unknown",
                "value": None,
                "column": None,
                "template": None,
                "constant": None,
                "parent_triples_map": None,
                "parent_triples_map_uri": None,
                "datatype": None,
                "term_type": None,
                "language": None,
                "joins": [],
            }
        column = graph.value(node, RR.column)
        template = graph.value(node, RR.template)
        constant = graph.value(node, RR.constant)
        parent = graph.value(node, RR.parentTriplesMap)
        if column is not None:
            kind, value = "column", str(column)
        elif template is not None:
            kind, value = "template", str(template)
        elif constant is not None:
            kind, value = "constant", str(constant)
        elif parent is not None:
            kind, value = "parentTriplesMap", str(parent)
        else:
            kind, value = "unknown", None
        joins = []
        for join in graph.objects(node, RR.joinCondition):
            joins.append(
                {
                    "child": _text(graph.value(join, RR.child)),
                    "parent": _text(graph.value(join, RR.parent)),
                }
            )
        return {
            "kind": kind,
            "value": value,
            "column": _text(column),
            "template": _text(template),
            "constant": self._qname(graph, constant),
            "parent_triples_map": self._qname(graph, parent),
            "parent_triples_map_uri": _text(parent),
            "datatype": self._qname(graph, graph.value(node, RR.datatype)),
            "term_type": self._qname(graph, graph.value(node, RR.termType)),
            "language": _text(graph.value(node, RR.language)),
            "joins": joins,
        }

    def _parse_file(self, path: Path) -> dict:
        descriptor = self._file_descriptor(path)
        graph = Graph()
        try:
            graph.parse(path, format="turtle")
        except Exception as exc:
            descriptor.update(
                {
                    "triples_maps": 0,
                    "table_names": 0,
                    "sql_queries": 0,
                    "joins": 0,
                    "parse_error": str(exc).splitlines()[0][:500],
                }
            )
            return {"file": descriptor, "mappings": []}
        triples_maps = sorted(
            {subject for subject in graph.subjects(RDF.type, RR.TriplesMap)},
            key=str,
        )
        mappings: list[dict] = []
        for tm in triples_maps:
            logical = graph.value(tm, RR.logicalTable)
            table_name = _text(graph.value(logical, RR.tableName)) if logical else None
            sql_query = _text(graph.value(logical, RR.sqlQuery)) if logical else None
            subject_node = graph.value(tm, RR.subjectMap)
            subject = self._term_map(graph, subject_node)
            classes = [self._qname(graph, value) for value in graph.objects(subject_node, RR['class'])] if subject_node else []
            canonical = self._qname(graph, graph.value(subject_node, OBDA.isCanonicalIRIOf)) if subject_node else None
            poms: list[dict] = []
            for pom_index, pom in enumerate(graph.objects(tm, RR.predicateObjectMap)):
                predicates = list(graph.objects(pom, RR.predicate))
                object_maps = list(graph.objects(pom, RR.objectMap))
                if not object_maps:
                    direct_objects = list(graph.objects(pom, RR.object))
                    object_maps = direct_objects
                if not predicates:
                    predicates = [None]
                if not object_maps:
                    object_maps = [None]
                for predicate in predicates:
                    for object_node in object_maps:
                        object_map = self._term_map(graph, object_node)
                        if object_node is not None and not isinstance(object_node, BNode):
                            if object_map["kind"] == "unknown":
                                object_map["kind"] = "constant"
                                object_map["value"] = str(object_node)
                                object_map["constant"] = self._qname(graph, object_node)
                        poms.append(
                            {
                                "id": f"{descriptor['id']}:pom:{len(poms)}",
                                "predicate": self._qname(graph, predicate),
                                "predicate_uri": _text(predicate),
                                "predicate_local_name": _local_name(_text(predicate)),
                                "object_map": object_map,
                                "source_index": pom_index,
                            }
                        )
            mappings.append(
                {
                    "id": f"{descriptor['id']}:{_short_hash(str(tm))}",
                    "uri": str(tm),
                    "qname": self._qname(graph, tm),
                    "name": _local_name(str(tm)),
                    "file_id": descriptor["id"],
                    "source_file": descriptor["path"],
                    "domain": descriptor["domain"],
                    "draft": descriptor["draft"],
                    "logical_table": {
                        "uri": self._qname(graph, logical),
                        "kind": "table" if table_name else "sql" if sql_query else "unknown",
                        "table_name": table_name,
                        "sql_query": sql_query,
                    },
                    "subject_map": subject,
                    "classes": [value for value in classes if value],
                    "class_uris": [str(value) for value in graph.objects(subject_node, RR['class'])] if subject_node else [],
                    "canonical_iri_of": canonical,
                    "predicate_object_maps": poms,
                }
            )
        descriptor["triples_maps"] = len(mappings)
        descriptor["table_names"] = len({item["logical_table"]["table_name"] for item in mappings if item["logical_table"]["table_name"]})
        descriptor["sql_queries"] = sum(bool(item["logical_table"]["sql_query"]) for item in mappings)
        descriptor["joins"] = sum(len(pom["object_map"]["joins"]) for item in mappings for pom in item["predicate_object_maps"])
        descriptor["parse_error"] = None
        return {"file": descriptor, "mappings": mappings}

    def _ontology_entities(self, domains: set[str]) -> tuple[set[str], set[str]]:
        classes: set[str] = set()
        properties: set[str] = set()
        for domain in domains:
            domain_root = self.root / domain
            if not domain_root.is_dir():
                continue
            for path in domain_root.rglob("*.ttl"):
                relative_parts = path.relative_to(domain_root).parts
                if "mappings" in relative_parts or any(part.startswith(".") for part in relative_parts):
                    continue
                graph = Graph()
                try:
                    graph.parse(path, format="turtle")
                except Exception:
                    continue
                for class_type in (OWL.Class, RDFS.Class):
                    classes.update(str(subject) for subject in graph.subjects(RDF.type, class_type))
                for property_type in (OWL.DatatypeProperty, OWL.ObjectProperty, RDF.Property):
                    properties.update(str(subject) for subject in graph.subjects(RDF.type, property_type))
        return classes, properties

    def _build_analysis(self, parsed_files: list[dict], domain: str | None, include_drafts: bool) -> dict:
        files = [item["file"] for item in parsed_files]
        mappings = [mapping for item in parsed_files for mapping in item["mappings"]]
        domains = {item["domain"] for item in files}
        ontology_classes, ontology_properties = self._ontology_entities(domains)
        issues: list[dict] = []
        tm_by_uri = {item["uri"]: item for item in mappings}
        tm_names = Counter(item["uri"] for item in mappings)
        template_groups: dict[str, list[dict]] = defaultdict(list)

        for file in files:
            if file.get("parse_error"):
                issues.append({"id": _short_hash(f"parse:{file['path']}"), "severity": "error", "code": "R2RML_TURTLE_PARSE_ERROR", "message": f"R2RML Turtle 解析失败：{file['parse_error']}", "mapping_id": None, "mapping_name": None, "entity_uri": None, "source_file": file["path"]})
            if file["triples_maps"] == 0:
                issues.append({"id": _short_hash(f"zero:{file['path']}"), "severity": "error", "code": "ZERO_TRIPLES_MAP", "message": "映射文件中没有发现 rr:TriplesMap，不能视为校验通过。", "mapping_id": None, "mapping_name": None, "entity_uri": None, "source_file": file["path"]})

        for mapping in mappings:
            table = mapping["logical_table"]
            if table["kind"] == "unknown":
                issues.append(_issue("error", "MISSING_LOGICAL_TABLE", mapping, "TriplesMap 缺少 rr:tableName 或 rr:sqlQuery。"))
            if mapping["subject_map"]["kind"] == "unknown":
                issues.append(_issue("error", "MISSING_SUBJECT_MAP", mapping, "TriplesMap 缺少可解析的 subjectMap。"))
            template = mapping["subject_map"]["template"]
            if template:
                template_groups[template].append(mapping)
            if not mapping["predicate_object_maps"]:
                if mapping["canonical_iri_of"]:
                    issues.append(_issue("info", "CANONICAL_IRI_DECLARATION", mapping, "该 TriplesMap 仅声明 Canonical IRI，0 个 PredicateObjectMap 属于合法结构。"))
                else:
                    issues.append(_issue("warning", "NO_PREDICATE_OBJECT_MAP", mapping, "TriplesMap 未定义 PredicateObjectMap。"))
            for class_uri in mapping["class_uris"]:
                if ontology_classes and class_uri not in ontology_classes:
                    issues.append(_issue("error", "ONTOLOGY_CLASS_NOT_FOUND", mapping, f"映射类 {_local_name(class_uri)} 未在当前领域本体中定义。", class_uri))
            for pom in mapping["predicate_object_maps"]:
                predicate_uri = pom["predicate_uri"]
                if predicate_uri and ontology_properties and predicate_uri not in ontology_properties:
                    issues.append(_issue("warning", "ONTOLOGY_PROPERTY_NOT_FOUND", mapping, f"映射属性 {pom['predicate_local_name']} 未在当前领域本体中定义。", predicate_uri))
                parent_qname = pom["object_map"]["parent_triples_map"]
                parent_uri = pom["object_map"]["parent_triples_map_uri"]
                if parent_qname and parent_uri not in tm_by_uri:
                    issues.append(_issue("error", "UNRESOLVED_PARENT_TRIPLES_MAP", mapping, f"parentTriplesMap {parent_qname} 无法解析。"))
                for join in pom["object_map"]["joins"]:
                    if not join["child"] or not join["parent"]:
                        issues.append(_issue("error", "INCOMPLETE_JOIN_CONDITION", mapping, "joinCondition 必须同时声明 rr:child 与 rr:parent。"))

        for uri, count in tm_names.items():
            if count > 1:
                issues.append({"id": _short_hash(f"duplicate:{uri}"), "severity": "error", "code": "DUPLICATE_TRIPLES_MAP", "message": f"TriplesMap URI 重复 {count} 次。", "mapping_id": None, "mapping_name": _local_name(uri), "entity_uri": uri, "source_file": None})
        for template, grouped in template_groups.items():
            if len(grouped) < 2:
                continue
            canonical_pair = any(item["canonical_iri_of"] for item in grouped)
            issues.append(_issue("info" if canonical_pair else "warning", "DUPLICATE_SUBJECT_TEMPLATE", grouped[0], f"Subject template 被 {len(grouped)} 个 TriplesMap 复用：{template}"))
        for file in files:
            if file["draft"]:
                issues.append({"id": _short_hash(f"draft:{file['path']}"), "severity": "info", "code": "DRAFT_MAPPING_FILE", "message": "草稿映射与正式映射隔离统计，不会自动并入主映射。", "mapping_id": None, "mapping_name": None, "entity_uri": None, "source_file": file["path"]})

        nodes, edges = self._lineage_graph(mappings)
        severity = Counter(issue["severity"] for issue in issues)
        columns = {
            (mapping["logical_table"]["table_name"], pom["object_map"]["column"])
            for mapping in mappings
            for pom in mapping["predicate_object_maps"]
            if pom["object_map"]["column"]
        }
        classes = {value for mapping in mappings for value in mapping["classes"]}
        properties = {pom["predicate"] for mapping in mappings for pom in mapping["predicate_object_maps"] if pom["predicate"]}
        joins = sum(len(pom["object_map"]["joins"]) for mapping in mappings for pom in mapping["predicate_object_maps"])
        sql_count = sum(bool(mapping["logical_table"]["sql_query"]) for mapping in mappings)
        meta = {
            "analysis_mode": "offline-r2rml",
            "database_connected": False,
            "sql_executed": False,
            "domain": domain or "all",
            "include_drafts": include_drafts,
            "total_files": len(files),
            "total_triples_maps": len(mappings),
            "total_tables": len({mapping["logical_table"]["table_name"] for mapping in mappings if mapping["logical_table"]["table_name"]}),
            "total_sql_queries": sql_count,
            "total_columns": len(columns),
            "total_classes": len(classes),
            "total_properties": len(properties),
            "total_joins": joins,
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "total_issues": len(issues),
            "quality": {"errors": severity["error"], "warnings": severity["warning"], "info": severity["info"]},
            "parsed_at": datetime.now(timezone.utc).isoformat(),
        }
        return {"meta": meta, "files": files, "mappings": mappings, "nodes": nodes, "edges": edges, "issues": issues}

    def _lineage_graph(self, mappings: list[dict]) -> tuple[list[dict], list[dict]]:
        nodes: dict[str, dict] = {}
        edges: dict[str, dict] = {}

        def node(node_id: str, node_type: str, label: str, **extra: object) -> None:
            nodes.setdefault(node_id, {"id": node_id, "type": node_type, "label": label, **extra})

        def edge(source: str, target: str, edge_type: str, label: str, mapping_id: str) -> None:
            edge_id = _short_hash(f"{source}|{target}|{edge_type}|{mapping_id}")
            edges[edge_id] = {"id": edge_id, "source": source, "target": target, "type": edge_type, "label": label, "mapping_id": mapping_id}

        for mapping in mappings:
            mapping_id = f"mapping:{mapping['id']}"
            node(mapping_id, "triples-map", mapping["name"], mapping_id=mapping["id"], domain=mapping["domain"], draft=mapping["draft"], source_file=mapping["source_file"])
            table_value = mapping["logical_table"]["table_name"] or mapping["logical_table"]["sql_query"] or "未声明逻辑表"
            table_id = f"table:{_short_hash(mapping['source_file'] + '|' + table_value)}"
            node(table_id, "table" if mapping["logical_table"]["table_name"] else "sql", table_value, source_file=mapping["source_file"], draft=mapping["draft"])
            edge(table_id, mapping_id, "logical-table", "逻辑表", mapping["id"])
            for class_name, class_uri in zip(mapping["classes"], mapping["class_uris"]):
                class_id = f"class:{_short_hash(class_uri)}"
                node(class_id, "class", class_name, uri=class_uri)
                edge(mapping_id, class_id, "class", "生成实体", mapping["id"])
            for pom in mapping["predicate_object_maps"]:
                predicate_uri = pom["predicate_uri"] or pom["predicate"] or "unknown"
                property_id = f"property:{_short_hash(predicate_uri)}"
                node(property_id, "property", pom["predicate_local_name"] or pom["predicate"] or "未声明属性", uri=predicate_uri)
                edge(mapping_id, property_id, "predicate", "映射属性", mapping["id"])
                object_map = pom["object_map"]
                if object_map["column"]:
                    column_key = f"{table_value}|{object_map['column']}"
                    column_id = f"column:{_short_hash(column_key)}"
                    node(column_id, "column", object_map["column"], table=table_value, datatype=object_map["datatype"])
                    edge(column_id, mapping_id, "column", "读取字段", mapping["id"])
                    edge(column_id, property_id, "column-property", "字段映射", mapping["id"])
                elif object_map["parent_triples_map"]:
                    parent_uri = object_map["parent_triples_map_uri"]
                    parent = next((item for item in mappings if item["uri"] == parent_uri), None)
                    if parent:
                        edge(mapping_id, f"mapping:{parent['id']}", "parent-triples-map", pom["predicate_local_name"] or "关联映射", mapping["id"])
                elif object_map["template"]:
                    template_id = f"template:{_short_hash(object_map['template'])}"
                    node(template_id, "template", object_map["template"], term_type=object_map["term_type"])
                    edge(mapping_id, template_id, "object-template", pom["predicate_local_name"] or "IRI 模板", mapping["id"])
        return list(nodes.values()), list(edges.values())


def _group_by(items: list[dict], key: str) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        grouped[str(item[key])].append(item)
    return dict(grouped)


def _issue(severity: str, code: str, mapping: dict, message: str, entity_uri: str | None = None) -> dict:
    return {
        "id": _short_hash(f"{code}:{mapping['id']}:{entity_uri or ''}:{message}"),
        "severity": severity,
        "code": code,
        "message": message,
        "mapping_id": mapping["id"],
        "mapping_name": mapping["name"],
        "entity_uri": entity_uri,
        "source_file": mapping["source_file"],
    }
