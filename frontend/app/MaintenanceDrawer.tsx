import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Clock3,
  Code2,
  Download,
  FileCode2,
  FileJson2,
  FileUp,
  GitCompareArrows,
  History,
  Image,
  LoaderCircle,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ChangePreview,
  EditAction,
  EditOperation,
  EntityType,
  MaintenanceDrawerProps,
  MaintenanceTab,
  OntologySourceSnapshot,
  OntologyVersion,
  VersionList,
} from "./maintenance-types";
import {
  downloadApiFile,
  loadSource,
  loadVersions,
  previewContent,
  previewOperations,
  restoreVersion,
  saveContent,
  splitIris,
} from "./ontology-maintenance";

type ExistingEntity = {
  uri: string;
  label: string;
  comment: string;
  entityType: EntityType;
  parentUris: string[];
  hasKeyUris: string[];
  domainUris: string[];
  rangeUris: string[];
  subPropertyOf: string[];
  inverseOf: string;
  isFunctional: boolean;
};

const TAB_LABELS: Array<{
  id: MaintenanceTab;
  label: string;
  icon: typeof PencilLine;
}> = [
  { id: "edit", label: "结构化编辑", icon: PencilLine },
  { id: "import", label: "导入本体", icon: FileUp },
  { id: "export", label: "导出", icon: Download },
  { id: "history", label: "版本历史", icon: History },
];

const TYPE_LABELS: Record<EntityType, string> = {
  class: "类（owl:Class）",
  datatype_property: "数据属性",
  object_property: "对象属性",
};

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

function iriPrefix(uri: string): string {
  const marker = Math.max(uri.lastIndexOf("#"), uri.lastIndexOf("/"));
  return marker >= 0 ? uri.slice(0, marker + 1) : uri;
}

export default function MaintenanceDrawer(props: MaintenanceDrawerProps) {
  const {
    open,
    onClose,
    baseUrl,
    domain,
    module,
    graph,
    selectedNode,
    onSaved,
    onExportView,
  } = props;
  const [tab, setTab] = useState<MaintenanceTab>("edit");
  const [source, setSource] = useState<OntologySourceSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("本体平台结构化维护");

  const [entityType, setEntityType] = useState<EntityType>("class");
  const [action, setAction] = useState<EditAction>("upsert");
  const [uri, setUri] = useState("");
  const [label, setLabel] = useState("");
  const [comment, setComment] = useState("");
  const [parentUris, setParentUris] = useState("");
  const [hasKeyUris, setHasKeyUris] = useState("");
  const [domainUris, setDomainUris] = useState("");
  const [rangeUris, setRangeUris] = useState("");
  const [subPropertyOf, setSubPropertyOf] = useState("");
  const [inverseOf, setInverseOf] = useState("");
  const [isFunctional, setIsFunctional] = useState(false);

  const [importMode, setImportMode] = useState<"replace" | "new">("replace");
  const [importName, setImportName] = useState("");
  const [importContent, setImportContent] = useState("");
  const [newModule, setNewModule] = useState("");

  const [versions, setVersions] = useState<VersionList | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<OntologyVersion | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);

  const existingEntities = useMemo<ExistingEntity[]>(() => {
    if (!graph) return [];
    const entities: ExistingEntity[] = graph.nodes.map((node) => ({
      uri: node.id,
      label: node.label || node.local_name,
      comment: node.comment || node.class_description || "",
      entityType: "class",
      parentUris: node.sub_class_of,
      hasKeyUris: node.has_key,
      domainUris: [],
      rangeUris: [],
      subPropertyOf: [],
      inverseOf: "",
      isFunctional: false,
    }));
    const seen = new Set(entities.map((item) => `class:${item.uri}`));
    graph.nodes.forEach((node) => {
      node.datatype_properties.forEach((property) => {
        const key = `datatype_property:${property.uri}`;
        const existing = entities.find((item) => `${item.entityType}:${item.uri}` === key);
        if (existing) {
          if (!existing.domainUris.includes(node.id)) existing.domainUris.push(node.id);
          return;
        }
        seen.add(key);
        entities.push({
          uri: property.uri,
          label: property.label || property.local_name,
          comment: property.comment || "",
          entityType: "datatype_property",
          parentUris: [],
          hasKeyUris: [],
          domainUris: [node.id],
          rangeUris: property.range,
          subPropertyOf: property.sub_property_of,
          inverseOf: "",
          isFunctional: property.is_functional,
        });
      });
      node.object_properties.forEach((property) => {
        const key = `object_property:${property.uri}`;
        const existing = entities.find((item) => `${item.entityType}:${item.uri}` === key);
        if (existing) {
          if (!existing.domainUris.includes(node.id)) existing.domainUris.push(node.id);
          return;
        }
        seen.add(key);
        entities.push({
          uri: property.uri,
          label: property.label || property.local_name,
          comment: property.comment || "",
          entityType: "object_property",
          parentUris: [],
          hasKeyUris: [],
          domainUris: [node.id],
          rangeUris: property.range,
          subPropertyOf: property.sub_property_of,
          inverseOf: property.inverse_of || "",
          isFunctional: false,
        });
      });
    });
    return entities.sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  }, [graph]);

  const matchingEntities = existingEntities.filter(
    (item) => item.entityType === entityType,
  );

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setAcknowledged(false);
    setError(null);
    setNotice(null);
    setBusy(true);
    loadSource(baseUrl, domain, module)
      .then((next) => setSource(next))
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "无法读取 TTL 源文件。"),
      )
      .finally(() => setBusy(false));
  }, [baseUrl, domain, module, open]);

  useEffect(() => {
    if (!open || !selectedNode) return;
    populateEntity({
      uri: selectedNode.id,
      label: selectedNode.label || selectedNode.local_name,
      comment: selectedNode.comment || selectedNode.class_description || "",
      entityType: "class",
      parentUris: selectedNode.sub_class_of,
      hasKeyUris: selectedNode.has_key,
      domainUris: [],
      rangeUris: [],
      subPropertyOf: [],
      inverseOf: "",
      isFunctional: false,
    });
  }, [open, selectedNode]);

  useEffect(() => {
    if (!open || tab !== "history") return;
    refreshVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, domain, module]);

  function changeTab(next: MaintenanceTab) {
    setTab(next);
    setPreview(null);
    setAcknowledged(false);
    setError(null);
    setNotice(null);
  }

  function resetForm(nextType = entityType) {
    const seed = selectedNode?.id || graph?.meta.ontology_iri || "https://example.com/ontology#";
    setAction("upsert");
    setUri(`${iriPrefix(seed)}New${nextType === "class" ? "Class" : "Property"}`);
    setLabel("");
    setComment("");
    setParentUris(nextType === "class" && selectedNode ? selectedNode.id : "");
    setHasKeyUris("");
    setDomainUris(nextType !== "class" && selectedNode ? selectedNode.id : "");
    setRangeUris("");
    setSubPropertyOf("");
    setInverseOf("");
    setIsFunctional(false);
    setPreview(null);
    setAcknowledged(false);
  }

  function populateEntity(entity: ExistingEntity) {
    setEntityType(entity.entityType);
    setAction("upsert");
    setUri(entity.uri);
    setLabel(entity.label);
    setComment(entity.comment);
    setParentUris(entity.parentUris.join("\n"));
    setHasKeyUris(entity.hasKeyUris.join("\n"));
    setDomainUris(entity.domainUris.join("\n"));
    setRangeUris(entity.rangeUris.join("\n"));
    setSubPropertyOf(entity.subPropertyOf.join("\n"));
    setInverseOf(entity.inverseOf);
    setIsFunctional(entity.isFunctional);
    setPreview(null);
    setAcknowledged(false);
  }

  async function buildOperationPreview() {
    if (!source) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const operation: EditOperation = {
      action,
      entity_type: entityType,
      uri: uri.trim(),
      label: label.trim(),
      comment: comment.trim(),
      parent_uris: splitIris(parentUris),
      has_key_uris: splitIris(hasKeyUris),
      domain_uris: splitIris(domainUris),
      range_uris: splitIris(rangeUris),
      sub_property_of: splitIris(subPropertyOf),
      inverse_of: inverseOf.trim(),
      is_functional: isFunctional,
    };
    try {
      const next = await previewOperations(baseUrl, {
        domain,
        module,
        base_hash: source.content_hash,
        operations: [operation],
      });
      setPreview(next);
      setAcknowledged(false);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "无法生成修改预览。");
    } finally {
      setBusy(false);
    }
  }

  async function readImport(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreview(null);
    if (!file.name.toLowerCase().endsWith(".ttl")) {
      setError("当前版本只接受 .ttl 文件。");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("TTL 文件不能超过 2 MiB。");
      return;
    }
    setImportName(file.name);
    setImportContent(await file.text());
    if (!newModule) {
      setNewModule(
        file.name
          .replace(/\.ttl$/i, "")
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, ""),
      );
    }
  }

  async function buildImportPreview() {
    if (!importContent || !source) {
      setError("请先选择一个 TTL 文件。");
      return;
    }
    const targetModule = importMode === "new" ? newModule : module;
    if (!targetModule) {
      setError("请输入新模块标识。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await previewContent(baseUrl, {
        domain,
        module: targetModule,
        content: importContent,
        base_hash: importMode === "new" ? null : source.content_hash,
        create_new: importMode === "new",
      });
      setPreview(next);
      setAcknowledged(false);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "导入预览失败。");
    } finally {
      setBusy(false);
    }
  }

  async function commitPreview() {
    if (!preview || !acknowledged || !preview.validation.valid || preview.conflict) return;
    setBusy(true);
    setError(null);
    try {
      await saveContent(baseUrl, {
        domain: preview.domain,
        module: preview.module,
        content: preview.content,
        base_hash: preview.create_new ? null : preview.base_hash,
        create_new: preview.create_new,
        reason: reason.trim() || "本体平台维护",
      });
      setNotice(
        preview.create_new
          ? `模块 ${preview.module} 已创建并通过复解析。`
          : "TTL 已原子保存，原始版本已进入历史记录。",
      );
      setPreview(null);
      setAcknowledged(false);
      if (!preview.create_new) {
        setSource(await loadSource(baseUrl, domain, module));
      }
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败，原文件未被覆盖。");
    } finally {
      setBusy(false);
    }
  }

  async function refreshVersions() {
    setBusy(true);
    setError(null);
    try {
      setVersions(await loadVersions(baseUrl, domain, module));
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "无法读取版本历史。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!restoreTarget || !versions || !restoreConfirmed) return;
    setBusy(true);
    setError(null);
    try {
      await restoreVersion(
        baseUrl,
        domain,
        module,
        restoreTarget.id,
        versions.current_hash,
      );
      setRestoreTarget(null);
      setRestoreConfirmed(false);
      setNotice("历史版本已恢复；恢复前的当前文件也已自动备份。");
      await refreshVersions();
      setSource(await loadSource(baseUrl, domain, module));
      await onSaved();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "版本恢复失败。");
    } finally {
      setBusy(false);
    }
  }

  async function exportApi(path: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      await downloadApiFile(baseUrl, path, name);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出失败。");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const cannotEditAggregate = module === "all";

  return (
    <div className="maintenance-layer" role="presentation">
      <button className="maintenance-backdrop" onClick={onClose} aria-label="关闭维护面板" />
      <section className="maintenance-drawer" role="dialog" aria-modal="true" aria-label="本体维护中心">
        <header className="maintenance-header">
          <div className="maintenance-title">
            <span className="maintenance-shield"><ShieldCheck size={20} /></span>
            <div>
              <small>SAFE MAINTENANCE</small>
              <h2>本体维护中心</h2>
              <p>{domain} / {module} · 默认草稿模式</p>
            </div>
          </div>
          <button className="maintenance-close" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>

        <nav className="maintenance-tabs" aria-label="维护功能">
          {TAB_LABELS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => changeTab(item.id)}>
                <Icon size={15} /> {item.label}
              </button>
            );
          })}
        </nav>

        <div className="maintenance-body">
          {source && (
            <div className="source-safety-strip">
              <span><ShieldCheck size={14} />{source.writable ? "写入保护已启用" : "当前文件只读"}</span>
              <code>{source.source_file}</code>
              <em>{formatBytes(source.size_bytes)} · {source.content_hash.slice(0, 8)}</em>
            </div>
          )}
          {error && <div className="maintenance-message error"><AlertTriangle size={16} />{error}</div>}
          {notice && <div className="maintenance-message success"><CheckCircle2 size={16} />{notice}</div>}

          {tab === "edit" && (
            <div className="maintenance-grid">
              <section className="maintenance-form-card">
                <div className="card-heading">
                  <div><small>01 / DRAFT</small><h3>结构化编辑</h3></div>
                  <button className="subtle-button" onClick={() => resetForm()}><Plus size={14} />新建实体</button>
                </div>
                {cannotEditAggregate && (
                  <div className="maintenance-message warning">
                    <AlertTriangle size={16} />完整本体是导入聚合视图，请切换到维度、指标、能力、场景或自定义模块后编辑。
                  </div>
                )}
                <div className="segmented-control">
                  {(Object.keys(TYPE_LABELS) as EntityType[]).map((value) => (
                    <button key={value} className={entityType === value ? "active" : ""} onClick={() => { setEntityType(value); resetForm(value); }}>
                      {TYPE_LABELS[value]}
                    </button>
                  ))}
                </div>
                <label className="maintenance-field">
                  <span>选择已有实体</span>
                  <select value={matchingEntities.some((item) => item.uri === uri) ? uri : ""} onChange={(event) => {
                    const entity = matchingEntities.find((item) => item.uri === event.target.value);
                    if (entity) populateEntity(entity);
                  }}>
                    <option value="">新建或手动输入 URI</option>
                    {matchingEntities.map((entity) => <option key={entity.uri} value={entity.uri}>{entity.label} · {entity.uri.split(/[\/#]/).pop()}</option>)}
                  </select>
                </label>
                <div className="action-switch">
                  <button className={action === "upsert" ? "active" : ""} onClick={() => setAction("upsert")}><PencilLine size={14} />新增 / 修改</button>
                  <button className={action === "delete" ? "danger active" : "danger"} onClick={() => setAction("delete")}><Trash2 size={14} />删除</button>
                </div>
                <label className="maintenance-field"><span>实体 URI</span><input value={uri} onChange={(event) => setUri(event.target.value)} placeholder="https://example.com/ontology#Entity" /></label>
                {action === "upsert" && (
                  <>
                    <div className="maintenance-field-row">
                      <label className="maintenance-field"><span>中文名称</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="实体名称" /></label>
                      {entityType === "datatype_property" && (
                        <label className="check-field"><input type="checkbox" checked={isFunctional} onChange={(event) => setIsFunctional(event.target.checked)} /><span>FunctionalProperty</span></label>
                      )}
                    </div>
                    <label className="maintenance-field"><span>业务描述</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="说明该实体或属性的语义" /></label>
                    {entityType === "class" ? (
                      <div className="maintenance-field-row two-columns">
                        <label className="maintenance-field"><span>父类 URI</span><textarea value={parentUris} onChange={(event) => setParentUris(event.target.value)} rows={3} placeholder="每行一个 URI" /></label>
                        <label className="maintenance-field"><span>hasKey URI</span><textarea value={hasKeyUris} onChange={(event) => setHasKeyUris(event.target.value)} rows={3} placeholder="每行一个属性 URI" /></label>
                      </div>
                    ) : (
                      <>
                        <div className="maintenance-field-row two-columns">
                          <label className="maintenance-field"><span>Domain URI</span><textarea value={domainUris} onChange={(event) => setDomainUris(event.target.value)} rows={3} placeholder="每行一个类 URI" /></label>
                          <label className="maintenance-field"><span>Range URI</span><textarea value={rangeUris} onChange={(event) => setRangeUris(event.target.value)} rows={3} placeholder="类或 XSD 类型 URI" /></label>
                        </div>
                        <label className="maintenance-field"><span>subPropertyOf URI</span><input value={subPropertyOf} onChange={(event) => setSubPropertyOf(event.target.value)} placeholder="可选，多个值用逗号分隔" /></label>
                        {entityType === "object_property" && <label className="maintenance-field"><span>inverseOf URI</span><input value={inverseOf} onChange={(event) => setInverseOf(event.target.value)} placeholder="可选的反向属性 URI" /></label>}
                      </>
                    )}
                  </>
                )}
                <button className="primary-maintenance-button" disabled={busy || !source || !uri.trim() || cannotEditAggregate} onClick={buildOperationPreview}>
                  {busy ? <LoaderCircle size={15} className="is-spinning" /> : <GitCompareArrows size={15} />}
                  生成修改预览
                </button>
              </section>
              <PreviewPanel preview={preview} acknowledged={acknowledged} setAcknowledged={setAcknowledged} reason={reason} setReason={setReason} busy={busy} onSave={commitPreview} />
            </div>
          )}

          {tab === "import" && (
            <div className="maintenance-grid">
              <section className="maintenance-form-card">
                <div className="card-heading"><div><small>01 / IMPORT</small><h3>导入 Turtle 本体</h3></div><UploadCloud size={20} /></div>
                <div className="segmented-control two">
                  <button className={importMode === "replace" ? "active" : ""} onClick={() => { setImportMode("replace"); setPreview(null); }}>替换当前模块</button>
                  <button className={importMode === "new" ? "active" : ""} onClick={() => { setImportMode("new"); setPreview(null); }}>新增自定义模块</button>
                </div>
                <label className="import-dropzone">
                  <input type="file" accept=".ttl,text/turtle" onChange={(event) => readImport(event.target.files?.[0])} />
                  <FileUp size={26} />
                  <strong>{importName || "选择 .ttl 文件"}</strong>
                  <span>上限 2 MiB；先解析和预览，不会立即写入</span>
                </label>
                {importMode === "new" && <label className="maintenance-field"><span>新模块标识</span><input value={newModule} onChange={(event) => setNewModule(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="asset-extension" /><small>仅允许小写字母、数字和连字符，保存到 custom 目录</small></label>}
                {importContent && <div className="import-file-summary"><FileCode2 size={16} /><div><strong>{importName}</strong><span>{formatBytes(new Blob([importContent]).size)} · UTF-8</span></div><Check size={15} /></div>}
                <button className="primary-maintenance-button" disabled={busy || !importContent} onClick={buildImportPreview}>{busy ? <LoaderCircle size={15} className="is-spinning" /> : <GitCompareArrows size={15} />}校验并预览导入</button>
              </section>
              <PreviewPanel preview={preview} acknowledged={acknowledged} setAcknowledged={setAcknowledged} reason={reason} setReason={setReason} busy={busy} onSave={commitPreview} />
            </div>
          )}

          {tab === "export" && (
            <section className="export-section">
              <div className="export-intro"><div><small>PORTABLE OUTPUT</small><h3>导出本体与当前视图</h3><p>导出操作只读取当前数据，不会创建历史版本或改动 TTL。</p></div><Archive size={30} /></div>
              <div className="export-grid">
                <ExportCard icon={FileCode2} title="当前模块 TTL" description="保留当前文件的 Turtle 文本与前缀" onClick={() => exportApi(`/api/v1/ontology/export/module?${new URLSearchParams({ domain, module, format: "ttl" })}`, `${domain}-${module}.ttl`)} />
                <ExportCard icon={FileJson2} title="图谱 JSON" description="导出 meta / nodes / edges / warnings" onClick={() => exportApi(`/api/v1/ontology/export/module?${new URLSearchParams({ domain, module, format: "json" })}`, `${domain}-${module}.json`)} />
                <ExportCard icon={Archive} title="整个领域 ZIP" description="打包该领域全部 TTL，不含历史版本" onClick={() => exportApi(`/api/v1/ontology/export/domain?${new URLSearchParams({ domain })}`, `${domain}-ontologies.zip`)} />
                <ExportCard icon={Image} title="当前视图 PNG" description="按画布当前布局导出高清图片" onClick={() => onExportView("png")} />
                <ExportCard icon={Code2} title="当前视图 SVG" description="可缩放的节点关系矢量图" onClick={() => onExportView("svg")} />
                <ExportCard icon={FileJson2} title="筛选视图 JSON" description="仅导出当前显示的节点和关系" onClick={() => onExportView("json")} />
              </div>
            </section>
          )}

          {tab === "history" && (
            <section className="history-section">
              <div className="history-heading"><div><small>LOCAL VERSION HISTORY</small><h3>可恢复版本</h3><p>每次写入前自动保存原文件的精确副本。</p></div><button className="subtle-button" onClick={refreshVersions}><RefreshCw size={14} />刷新</button></div>
              {versions?.versions.length ? (
                <div className="version-list">
                  {versions.versions.map((version) => (
                    <article key={version.id}>
                      <span className="version-dot"><Clock3 size={15} /></span>
                      <div className="version-copy"><strong>{version.reason}</strong><span>{formatDate(version.created_at)} · {formatBytes(version.size_bytes)}</span><code>{version.content_hash.slice(0, 12)} · {version.id}</code></div>
                      <button onClick={() => { setRestoreTarget(version); setRestoreConfirmed(false); }}><RotateCcw size={14} />恢复</button>
                    </article>
                  ))}
                </div>
              ) : !busy && <div className="history-empty"><History size={28} /><strong>尚无历史版本</strong><span>第一次保存后，这里会出现保存前的原始文件。</span></div>}
              {restoreTarget && (
                <div className="restore-confirm">
                  <AlertTriangle size={18} />
                  <div><strong>确认恢复“{restoreTarget.reason}”</strong><p>当前文件会先自动备份，再替换为该历史版本。</p><label><input type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} />我已理解恢复影响</label></div>
                  <div><button className="subtle-button" onClick={() => setRestoreTarget(null)}>取消</button><button className="danger-button" disabled={!restoreConfirmed || busy} onClick={confirmRestore}><RotateCcw size={14} />确认恢复</button></div>
                </div>
              )}
            </section>
          )}
        </div>

        {busy && <div className="maintenance-busy"><LoaderCircle size={22} className="is-spinning" /><span>正在执行安全检查…</span></div>}
      </section>
    </div>
  );
}

function PreviewPanel({
  preview,
  acknowledged,
  setAcknowledged,
  reason,
  setReason,
  busy,
  onSave,
}: {
  preview: ChangePreview | null;
  acknowledged: boolean;
  setAcknowledged: (value: boolean) => void;
  reason: string;
  setReason: (value: string) => void;
  busy: boolean;
  onSave: () => void;
}) {
  if (!preview) {
    return (
      <section className="preview-card empty">
        <GitCompareArrows size={32} />
        <strong>等待修改预览</strong>
        <p>草稿会先经过 Turtle 语法、语义关系、继承环和文件冲突检查。</p>
        <div className="safety-steps"><span><i>1</i>生成草稿</span><span><i>2</i>校验并比较</span><span><i>3</i>确认后原子保存</span></div>
      </section>
    );
  }
  const validation = preview.validation;
  return (
    <section className="preview-card">
      <div className="card-heading"><div><small>02 / REVIEW</small><h3>校验与差异预览</h3></div><span className={`validation-badge ${validation.valid && !preview.conflict ? "valid" : "invalid"}`}>{validation.valid && !preview.conflict ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{validation.valid && !preview.conflict ? "可安全保存" : "禁止保存"}</span></div>
      <div className="diff-stats"><div className="added"><strong>+{preview.diff.added_triples}</strong><span>新增三元组</span></div><div className="removed"><strong>-{preview.diff.removed_triples}</strong><span>删除三元组</span></div><div><strong>{validation.summary.triples}</strong><span>草稿三元组</span></div><div><strong>{validation.warnings}</strong><span>校验警告</span></div></div>
      {preview.conflict && <div className="maintenance-message error"><AlertTriangle size={16} />源文件已变化，请关闭面板重新加载后再操作。</div>}
      {preview.impacts?.map((impact) => <div className="delete-impact" key={impact.uri}><Trash2 size={15} /><div><strong>删除影响</strong><p>{impact.message} 实体自身包含 {impact.owned_triples} 条声明。</p></div></div>)}
      {validation.issues.length > 0 && <div className="validation-issues">{validation.issues.slice(0, 8).map((issue, index) => <article key={`${issue.code}-${index}`} className={issue.severity}><AlertTriangle size={14} /><div><strong>{issue.code}</strong><p>{issue.message}</p></div></article>)}</div>}
      <div className="diff-view" aria-label="TTL 文本差异">
        <div className="diff-heading"><span><Code2 size={14} />TTL 差异</span><em>语义保存后排版可能规范化</em></div>
        <pre>{preview.diff.lines.length ? preview.diff.lines.map((line, index) => <span key={index} className={line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : ""}>{line || " "}{"\n"}</span>) : <span>没有文本差异</span>}</pre>
      </div>
      <label className="maintenance-field"><span>版本说明</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={160} placeholder="说明本次修改原因" /></label>
      <label className="save-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>我已检查差异；保存前系统会自动备份原始 TTL</span></label>
      <button className="save-button" disabled={!acknowledged || !validation.valid || preview.conflict || busy} onClick={onSave}><Save size={15} />确认保存到 TTL</button>
    </section>
  );
}

function ExportCard({ icon: Icon, title, description, onClick }: { icon: typeof Download; title: string; description: string; onClick: () => void }) {
  return <button className="export-card" onClick={onClick}><span><Icon size={21} /></span><div><strong>{title}</strong><p>{description}</p></div><Download size={15} /></button>;
}
