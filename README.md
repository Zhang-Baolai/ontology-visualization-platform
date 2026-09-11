# 本体可视化与维护平台 v1.5.3

用于本地 RDF/OWL Turtle 本体的可视化、语义分析与维护。前端使用 React、TypeScript、Cytoscape.js 和 Three.js，后端使用 FastAPI 与 RDFLib。

本发布版基于正式版 v1.5.3，保留浅色三维画布、矩形节点卡片、关系拖动、展示别名和本体维护功能。内置数据全部为虚构的公共示例。

## 功能

- 二维与三维关系图：布局、搜索、聚焦、主题切换、关系弧线调整和自动巡航。
- 展示别名：保存在浏览器本地，不改写本体 URI 或 TTL。
- 语义分析：类层次、跨模块关系、邻域、最短路径、影响分析和质量报告。
- 本体维护：编辑类与属性、TTL 导入导出、差异预览、哈希冲突检查、原子写入、历史备份和恢复。
- 离线 R2RML：逻辑表、映射和本体三层浏览，Join 分析、Draft 筛选和质量检查；不连接数据库、不执行 SQL。
- 导出：JSON、CSV、PNG、SVG 与 TTL，具体格式取决于当前视图。

## 快速启动

需要 Python 3.12 和 Node.js 22.13 以上版本。

Windows：

1. 克隆或解压本仓库。
2. 双击 `setup.cmd` 安装依赖。
3. 双击 `start.cmd` 启动前后端。
4. 打开 <http://127.0.0.1:5173>，选择 `Cloud Demo` 或 `Service Demo`。

三维视图左上角会显示 `v1.5.3 · 明亮模式`。启动脚本会检查 8000 和 5173 端口，已有进程占用时请先停止旧进程。

macOS / Linux，在两个终端分别运行：

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```sh
cd frontend
npm ci
npm run dev
```

后端接口文档：<http://127.0.0.1:8000/docs>。后端未启动时，可切换到 Mock 示例数据查看二维和三维图；维护及后端分析需要运行 API。

## 公共示例与自有本体

`ontologies/cloud-demo` 和 `ontologies/service-demo` 各包含维度、指标、能力、场景四个模块，以及本地 imports 入口和虚构 R2RML 映射。URI 使用 `https://example.org/`，示例逻辑表使用 `demo.*`。

默认仅读取仓库内示例。接入自己的本体时，显式设置 `ONTOLOGY_ROOT`，该目录下每个领域使用如下结构：

```text
my-domain/
  data_ontology.ttl
  core/dimension_ontology.ttl
  core/metric_ontology.ttl
  capability/capability_ontology.ttl
  scenario/scenario_ontology.ttl
  mappings/example.r2rml.ttl
  custom/optional-module.ttl
```

领域与自定义模块名仅使用小写字母、数字和连字符。导入只解析领域目录内的本地文件，不获取远程本体。

| 环境变量 | 用途 |
| --- | --- |
| `ONTOLOGY_ROOT` | 自有本体根目录；默认使用包内示例 |
| `ONTOLOGY_HISTORY_ROOT` | 写入历史目录；默认在本体目录的 `.ontology-history` 下 |
| `ONTOLOGY_MAX_TTL_BYTES` | 单次 TTL 草稿大小上限；默认 2 MiB |
| `ONTOLOGY_CORS_ORIGINS` | 允许的前端来源，多个值以逗号分隔 |
| `VITE_API_BASE_URL` | 前端默认服务地址，参见 `frontend/.env.example` |

请将私人本体存放在仓库外，通过环境变量接入。`.env`、依赖、构建产物和修改历史已加入忽略规则。

## 开发与验证

```sh
cd backend
python -m pytest -q
cd ../frontend
npm test
npm run build
```

Python 测试请使用已安装依赖的虚拟环境。重新生成 Mock 数据：在仓库根目录使用该环境运行 `python scripts/generate_mock.py`。

主要源码：`frontend/app/OntologyStudio.tsx` 为主工作台，`OntologyGraph3D.tsx` 为三维视图；`backend/app/services/` 包含解析、分析、维护和映射服务。

## 许可与使用范围

本项目采用 [Apache-2.0](LICENSE)。第三方许可和原包中的设计参考说明保留在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

该版本面向本地运行，维护 API 没有用户认证。公开部署后端前需要自行配置认证、访问控制与备份。GitHub Pages 只能承载静态前端，不能运行本项目的 Python API。

发布数据处理说明见 [SANITIZATION.md](SANITIZATION.md)，验证结果见 [VALIDATION.md](VALIDATION.md)。
