"""Safe Turtle maintenance, import/export preview and local version history."""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from urllib.parse import urlparse

from rdflib import BNode, Graph, Literal, URIRef
from rdflib.collection import Collection
from rdflib.compare import to_canonical_graph
from rdflib.namespace import OWL, RDF, RDFS, SKOS

from app.config import (
    HISTORY_ROOT,
    MAX_TTL_BYTES,
    OntologySource,
    resolve_new_custom_source,
    resolve_source,
    to_display_path,
)
from app.services.ontology_parser import OntologyParseError, OntologyParser


class MaintenanceConflictError(RuntimeError):
    """Raised when a file changed after a draft was opened."""


class MaintenanceValidationError(RuntimeError):
    """Raised when content fails the write-time validation gate."""


class VersionNotFoundError(RuntimeError):
    """Raised when a requested local history version is unavailable."""


MANAGED_PREDICATES = {
    RDFS.label,
    RDFS.comment,
    RDFS.subClassOf,
    RDFS.domain,
    RDFS.range,
    RDFS.subPropertyOf,
    OWL.inverseOf,
    OWL.hasKey,
    SKOS.altLabel,
}


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _sha256_text(content: str) -> str:
    return _sha256_bytes(content.encode("utf-8"))


def _is_absolute_iri(value: str) -> bool:
    parsed = urlparse(value)
    return bool(parsed.scheme and not any(char.isspace() for char in value))


def _safe_reason(value: str | None, fallback: str) -> str:
    cleaned = " ".join((value or "").strip().split())
    return (cleaned or fallback)[:160]


class OntologyMaintenanceService:
    def __init__(
        self,
        *,
        parser: OntologyParser | None = None,
        history_root: Path | None = None,
        max_bytes: int = MAX_TTL_BYTES,
    ) -> None:
        self._parser = parser or OntologyParser()
        self._history_root = (history_root or HISTORY_ROOT).resolve()
        self._max_bytes = max_bytes
        self._lock = RLock()

    def source(self, domain: str, module: str) -> dict:
        source = resolve_source(domain, module)
        content = self._read_text(source.path)
        stat = source.path.stat()
        return {
            "domain": domain,
            "module": module,
            "source_file": to_display_path(source.path),
            "content": content,
            "content_hash": _sha256_text(content),
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.utc
            ).isoformat(),
            "writable": os.access(source.path, os.W_OK),
        }

    def validate(self, content: str) -> dict:
        byte_size = len(content.encode("utf-8"))
        issues: list[dict] = []
        if byte_size > self._max_bytes:
            issues.append(
                self._issue(
                    "error",
                    "FILE_TOO_LARGE",
                    f"TTL 内容超过 {self._max_bytes // 1024} KiB 的安全上限。",
                )
            )
            return self._validation_result(None, issues, byte_size)

        graph = Graph()
        try:
            graph.parse(
                data=content,
                format="turtle",
                publicID="urn:ontology-maintenance:draft",
            )
        except Exception as exc:
            issues.append(
                self._issue(
                    "error",
                    "TURTLE_SYNTAX_ERROR",
                    self._clean_parse_message(exc),
                )
            )
            return self._validation_result(None, issues, byte_size)

        classes = {
            item for item in graph.subjects(RDF.type, OWL.Class) if isinstance(item, URIRef)
        }
        datatype_properties = {
            item
            for item in graph.subjects(RDF.type, OWL.DatatypeProperty)
            if isinstance(item, URIRef)
        }
        object_properties = {
            item
            for item in graph.subjects(RDF.type, OWL.ObjectProperty)
            if isinstance(item, URIRef)
        }

        overlap = datatype_properties & object_properties
        for uri in sorted(overlap, key=str):
            issues.append(
                self._issue(
                    "error",
                    "PROPERTY_TYPE_CONFLICT",
                    "同一 URI 不能同时声明为数据属性和对象属性。",
                    str(uri),
                )
            )

        for prop in sorted(datatype_properties | object_properties, key=str):
            if not any(True for _ in graph.objects(prop, RDFS.domain)):
                issues.append(
                    self._issue(
                        "warning",
                        "PROPERTY_WITHOUT_DOMAIN",
                        "属性未声明 rdfs:domain。",
                        str(prop),
                    )
                )
            if not any(True for _ in graph.objects(prop, RDFS.range)):
                issues.append(
                    self._issue(
                        "warning",
                        "PROPERTY_WITHOUT_RANGE",
                        "属性未声明 rdfs:range。",
                        str(prop),
                    )
                )

        for child, parent in graph.subject_objects(RDFS.subClassOf):
            if isinstance(parent, URIRef) and parent not in classes:
                issues.append(
                    self._issue(
                        "warning",
                        "UNDECLARED_PARENT_CLASS",
                        "父类 URI 未在当前文件中显式声明为 owl:Class。",
                        str(child),
                        str(parent),
                    )
                )

        cycles = self._subclass_cycles(graph, classes)
        for cycle in cycles:
            issues.append(
                self._issue(
                    "error",
                    "SUBCLASS_CYCLE",
                    "检测到继承环：" + " → ".join(self._short_uri(item) for item in cycle),
                    cycle[0],
                )
            )

        return self._validation_result(
            graph,
            issues,
            byte_size,
            {
                "classes": len(classes),
                "datatype_properties": len(datatype_properties),
                "object_properties": len(object_properties),
                "triples": len(graph),
            },
        )

    def preview_content(
        self,
        domain: str,
        module: str,
        content: str,
        base_hash: str | None,
        *,
        create_new: bool = False,
    ) -> dict:
        source = (
            resolve_new_custom_source(domain, module)
            if create_new
            else resolve_source(domain, module)
        )
        original = "" if create_new else self._read_text(source.path)
        current_hash = None if create_new else _sha256_text(original)
        conflict = bool(base_hash and current_hash and base_hash != current_hash)
        validation = self.validate(content)
        delta = self._semantic_delta(original, content)
        return {
            "domain": domain,
            "module": module,
            "source_file": to_display_path(source.path),
            "base_hash": current_hash,
            "draft_hash": _sha256_text(content),
            "conflict": conflict,
            "validation": validation,
            "diff": {
                **delta,
                "lines": self._unified_diff(original, content),
            },
            "content": content,
            "create_new": create_new,
        }

    def preview_operations(
        self,
        domain: str,
        module: str,
        base_hash: str,
        operations: list[dict],
    ) -> dict:
        if module == "all":
            raise MaintenanceValidationError(
                "完整本体由 owl:imports 聚合生成，请切换到具体模块后再结构化编辑。"
            )
        source = resolve_source(domain, module)
        original = self._read_text(source.path)
        if _sha256_text(original) != base_hash:
            raise MaintenanceConflictError("TTL 文件已被其他程序修改，请重新加载后再编辑。")

        graph = Graph()
        graph.parse(data=original, format="turtle", publicID=source.path.as_uri())
        impacts: list[dict] = []
        for operation in operations:
            impact = self._apply_operation(graph, operation)
            if impact:
                impacts.append(impact)

        content = graph.serialize(format="turtle")
        preview = self.preview_content(domain, module, content, base_hash)
        preview["impacts"] = impacts
        return preview

    def save(
        self,
        domain: str,
        module: str,
        content: str,
        base_hash: str | None,
        reason: str | None,
        *,
        create_new: bool = False,
    ) -> dict:
        validation = self.validate(content)
        if not validation["valid"]:
            raise MaintenanceValidationError("TTL 校验未通过，未写入文件。")

        with self._lock:
            source = (
                resolve_new_custom_source(domain, module)
                if create_new
                else resolve_source(domain, module)
            )
            old_content: str | None = None
            backup: dict | None = None
            if not create_new:
                old_content = self._read_text(source.path)
                current_hash = _sha256_text(old_content)
                if not base_hash or base_hash != current_hash:
                    raise MaintenanceConflictError(
                        "TTL 文件已被其他程序修改，请重新加载差异后再保存。"
                    )
                backup = self._create_backup(
                    source,
                    old_content,
                    _safe_reason(reason, "保存前自动备份"),
                )
            elif base_hash:
                raise MaintenanceConflictError("新增模块不接受已有文件哈希。")

            try:
                self._atomic_write(source.path, content)
                self._parser.parse(source)
            except Exception as exc:
                if old_content is not None:
                    self._atomic_write(source.path, old_content)
                elif source.path.exists():
                    source.path.unlink()
                if isinstance(exc, OntologyParseError):
                    raise MaintenanceValidationError(
                        "写入后的完整本体复解析失败，已自动恢复原文件。"
                    ) from exc
                raise

            return {
                "saved": True,
                "domain": domain,
                "module": module,
                "source_file": to_display_path(source.path),
                "content_hash": _sha256_text(content),
                "size_bytes": len(content.encode("utf-8")),
                "backup": backup,
                "created": create_new,
                "saved_at": datetime.now(timezone.utc).isoformat(),
            }

    def list_versions(self, domain: str, module: str) -> dict:
        source = resolve_source(domain, module)
        version_dir = self._version_dir(source)
        versions: list[dict] = []
        if version_dir.is_dir():
            for metadata_path in sorted(
                version_dir.glob("*.json"), reverse=True
            ):
                try:
                    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                ttl_path = version_dir / f"{metadata_path.stem}.ttl"
                if not ttl_path.is_file():
                    continue
                versions.append(metadata)
        return {
            "domain": domain,
            "module": module,
            "current_hash": _sha256_text(self._read_text(source.path)),
            "versions": versions,
        }

    def restore(
        self,
        domain: str,
        module: str,
        version_id: str,
        expected_hash: str,
    ) -> dict:
        if not version_id or any(char not in "0123456789TZ.-_abcdef" for char in version_id):
            raise VersionNotFoundError("版本标识无效。")

        with self._lock:
            source = resolve_source(domain, module)
            current = self._read_text(source.path)
            if _sha256_text(current) != expected_hash:
                raise MaintenanceConflictError(
                    "TTL 文件已发生变化，请刷新版本历史后再恢复。"
                )
            version_dir = self._version_dir(source)
            backup_path = (version_dir / f"{version_id}.ttl").resolve()
            try:
                backup_path.relative_to(version_dir.resolve())
            except ValueError as exc:
                raise VersionNotFoundError("版本标识无效。") from exc
            if not backup_path.is_file():
                raise VersionNotFoundError("历史版本不存在。")

            restore_content = self._read_text(backup_path)
            validation = self.validate(restore_content)
            if not validation["valid"]:
                raise MaintenanceValidationError("历史版本无法通过当前校验规则。")

            self._create_backup(source, current, f"恢复 {version_id} 前自动备份")
            try:
                self._atomic_write(source.path, restore_content)
                self._parser.parse(source)
            except Exception as exc:
                self._atomic_write(source.path, current)
                raise MaintenanceValidationError(
                    "恢复后的完整本体复解析失败，已保留当前版本。"
                ) from exc

            return {
                "restored": True,
                "version_id": version_id,
                "content_hash": _sha256_text(restore_content),
                "restored_at": datetime.now(timezone.utc).isoformat(),
            }

    def _apply_operation(self, graph: Graph, operation: dict) -> dict | None:
        action = operation.get("action")
        entity_type = operation.get("entity_type")
        uri_text = str(operation.get("uri") or "").strip()
        if action not in {"upsert", "delete"}:
            raise MaintenanceValidationError("不支持的编辑动作。")
        if entity_type not in {"class", "datatype_property", "object_property"}:
            raise MaintenanceValidationError("不支持的实体类型。")
        if not _is_absolute_iri(uri_text):
            raise MaintenanceValidationError("实体 URI 必须是绝对 IRI。")

        uri = URIRef(uri_text)
        if action == "delete":
            references = sum(1 for _ in graph.triples((None, None, uri)))
            owned = sum(1 for _ in graph.triples((uri, None, None)))
            for triple in list(graph.triples((uri, None, None))):
                graph.remove(triple)
            for triple in list(graph.triples((None, None, uri))):
                graph.remove(triple)
            return {
                "action": "delete",
                "uri": uri_text,
                "owned_triples": owned,
                "reference_triples": references,
                "message": f"删除实体同时移除了 {references} 条引用关系。",
            }

        self._remove_managed_statements(graph, uri)
        graph.remove((uri, RDF.type, OWL.Class))
        graph.remove((uri, RDF.type, OWL.DatatypeProperty))
        graph.remove((uri, RDF.type, OWL.ObjectProperty))
        graph.remove((uri, RDF.type, OWL.FunctionalProperty))

        rdf_type = {
            "class": OWL.Class,
            "datatype_property": OWL.DatatypeProperty,
            "object_property": OWL.ObjectProperty,
        }[entity_type]
        graph.add((uri, RDF.type, rdf_type))

        label = str(operation.get("label") or "").strip()
        comment = str(operation.get("comment") or "").strip()
        if label:
            graph.add((uri, RDFS.label, Literal(label, lang="zh")))
        if comment:
            graph.add((uri, RDFS.comment, Literal(comment, lang="zh")))

        if entity_type == "class":
            for parent in self._iri_list(operation.get("parent_uris"), "父类 URI"):
                graph.add((uri, RDFS.subClassOf, parent))
            key_values = self._iri_list(operation.get("has_key_uris"), "唯一键 URI")
            if key_values:
                head = BNode()
                Collection(graph, head, key_values)
                graph.add((uri, OWL.hasKey, head))
        else:
            for domain in self._iri_list(operation.get("domain_uris"), "Domain URI"):
                graph.add((uri, RDFS.domain, domain))
            for range_uri in self._iri_list(operation.get("range_uris"), "Range URI"):
                graph.add((uri, RDFS.range, range_uri))
            for parent in self._iri_list(
                operation.get("sub_property_of"), "父属性 URI"
            ):
                graph.add((uri, RDFS.subPropertyOf, parent))

        if entity_type == "datatype_property" and operation.get("is_functional"):
            graph.add((uri, RDF.type, OWL.FunctionalProperty))

        if entity_type == "object_property":
            inverse = str(operation.get("inverse_of") or "").strip()
            if inverse:
                if not _is_absolute_iri(inverse):
                    raise MaintenanceValidationError("反向属性 URI 必须是绝对 IRI。")
                graph.add((uri, OWL.inverseOf, URIRef(inverse)))
        return None

    @staticmethod
    def _remove_managed_statements(graph: Graph, uri: URIRef) -> None:
        list_heads = [
            obj
            for predicate in (OWL.hasKey,)
            for obj in graph.objects(uri, predicate)
            if isinstance(obj, BNode)
        ]
        for predicate in MANAGED_PREDICATES:
            graph.remove((uri, predicate, None))
        for head in list_heads:
            try:
                Collection(graph, head).clear()
            except Exception:
                continue

    @staticmethod
    def _iri_list(value: object, label: str) -> list[URIRef]:
        if value is None:
            return []
        raw_items = value if isinstance(value, list) else [value]
        output: list[URIRef] = []
        for raw in raw_items:
            text = str(raw).strip()
            if not text:
                continue
            if not _is_absolute_iri(text):
                raise MaintenanceValidationError(f"{label} 必须是绝对 IRI。")
            output.append(URIRef(text))
        return output

    def _create_backup(
        self, source: OntologySource, content: str, reason: str
    ) -> dict:
        version_dir = self._version_dir(source)
        version_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        content_hash = _sha256_text(content)
        version_id = f"{stamp}_{content_hash[:8]}"
        ttl_path = version_dir / f"{version_id}.ttl"
        metadata_path = version_dir / f"{version_id}.json"
        self._atomic_write(ttl_path, content)
        metadata = {
            "id": version_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
            "content_hash": content_hash,
            "size_bytes": len(content.encode("utf-8")),
            "source_file": to_display_path(source.path),
        }
        self._atomic_write(metadata_path, json.dumps(metadata, ensure_ascii=False, indent=2))
        return metadata

    def _version_dir(self, source: OntologySource) -> Path:
        path = (self._history_root / source.domain / source.module).resolve()
        try:
            path.relative_to(self._history_root)
        except ValueError as exc:
            raise MaintenanceValidationError("历史版本目录无效。") from exc
        return path

    @staticmethod
    def _atomic_write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="\n",
                prefix=f".{path.name}.",
                suffix=".tmp",
                dir=path.parent,
                delete=False,
            ) as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
                temporary = Path(handle.name)
            os.replace(temporary, path)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()

    @staticmethod
    def _read_text(path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise MaintenanceValidationError("TTL 文件不是有效的 UTF-8 文本。") from exc

    @staticmethod
    def _issue(
        severity: str,
        code: str,
        message: str,
        subject: str | None = None,
        related: str | None = None,
    ) -> dict:
        return {
            "severity": severity,
            "code": code,
            "message": message,
            "subject": subject,
            "related": related,
        }

    @staticmethod
    def _validation_result(
        graph: Graph | None,
        issues: list[dict],
        byte_size: int,
        summary: dict | None = None,
    ) -> dict:
        errors = sum(1 for issue in issues if issue["severity"] == "error")
        warnings = sum(1 for issue in issues if issue["severity"] == "warning")
        return {
            "valid": graph is not None and errors == 0,
            "errors": errors,
            "warnings": warnings,
            "issues": issues,
            "summary": summary
            or {
                "classes": 0,
                "datatype_properties": 0,
                "object_properties": 0,
                "triples": 0,
            },
            "size_bytes": byte_size,
        }

    @staticmethod
    def _clean_parse_message(exc: Exception) -> str:
        message = " ".join(str(exc).split())
        if len(message) > 360:
            message = message[:357] + "..."
        return f"Turtle 语法解析失败：{message}"

    @staticmethod
    def _short_uri(value: str) -> str:
        marker = max(value.rfind("#"), value.rfind("/"))
        return value[marker + 1 :] if marker >= 0 else value

    @staticmethod
    def _subclass_cycles(graph: Graph, classes: set[URIRef]) -> list[list[str]]:
        parents = {
            child: {
                parent
                for parent in graph.objects(child, RDFS.subClassOf)
                if isinstance(parent, URIRef) and parent in classes
            }
            for child in classes
        }
        cycles: list[list[str]] = []
        seen_cycles: set[tuple[str, ...]] = set()

        def walk(node: URIRef, path: list[URIRef], active: set[URIRef]) -> None:
            if node in active:
                start = path.index(node)
                cycle = [str(item) for item in path[start:]] + [str(node)]
                signature = tuple(sorted(cycle[:-1]))
                if signature not in seen_cycles:
                    seen_cycles.add(signature)
                    cycles.append(cycle)
                return
            if len(path) > len(classes):
                return
            for parent in parents.get(node, set()):
                walk(parent, [*path, node], {*active, node})

        for class_uri in sorted(classes, key=str):
            walk(class_uri, [], set())
        return cycles

    @staticmethod
    def _canonical_triples(content: str) -> set[tuple[str, str, str]]:
        if not content.strip():
            return set()
        graph = Graph()
        try:
            graph.parse(data=content, format="turtle", publicID="urn:ontology-diff")
        except Exception:
            return set()
        canonical = to_canonical_graph(graph)
        return {
            (subject.n3(), predicate.n3(), obj.n3())
            for subject, predicate, obj in canonical
        }

    def _semantic_delta(self, original: str, draft: str) -> dict:
        before = self._canonical_triples(original)
        after = self._canonical_triples(draft)
        return {
            "added_triples": len(after - before),
            "removed_triples": len(before - after),
            "unchanged_triples": len(before & after),
        }

    @staticmethod
    def _unified_diff(original: str, draft: str) -> list[str]:
        lines = list(
            difflib.unified_diff(
                original.splitlines(),
                draft.splitlines(),
                fromfile="当前版本",
                tofile="草稿版本",
                lineterm="",
                n=3,
            )
        )
        if len(lines) > 500:
            return [*lines[:500], "... 差异过长，仅显示前 500 行 ..."]
        return lines
