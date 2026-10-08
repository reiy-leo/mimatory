# 任务页 Tailwind UI 设计规格

> **Not this project.** Every entry point this spec names (`src/pages/TasksPage.tsx`,
> `src/components/tasks/**`) is absent, and the `theme-*` utility family it is written against
> (`bg-theme-100`, `text-theme-700`, …) is not defined in this `tailwind.config.js` — its tokens
> are flat design-token names resolved through `var(--color-*)`. Passless does have a *small*
> `--theme-*` alias group (`styles.css:79-86`), and those aliases must stay derived from
> `--color-*`; do not extend them into a second colour system. The live design source is
> `docs/design/2026-10-07-cupertino-vault-design-spec.md`.

> 供其他 agent 复用。目标不是复刻业务，而是复刻观感：密集、低对比、主题色驱动、图标化控制、轻边框、少装饰。新增任务相关界面时优先复制这些 Tailwind 配方。

## 总体设计语言

任务页是高频工作台，UI 要安静、紧凑、可扫描。默认不要做大卡片、hero、插画、营销说明或高饱和背景。

首选 token：

- 主色系：`theme-*`，例如 `bg-theme-100`、`text-theme-700`、`border-theme-200`、`dark:bg-theme-800`。
- CSS 变量：`var(--theme-bg-2)`、`var(--theme-color)`、`var(--theme-bg-70)`、`var(--theme-text-70)`。
- 语义色只用于状态：逾期 `text-red-500`，未来日期 `text-green-500`，优先级 `text-orange-500 bg-orange-50 dark:bg-orange-900/20`，失败 `text-red-400 bg-red-50 border-red-200`。
- 看板/特殊视图内部可用 `gray-*` / `blue-*` 等语义色，但外层壳、设置、列表、详情仍保持 `theme-*`。

基础偏好：

- 字号：主体 `text-sm`，辅助 `text-xs`，极小标签 `text-[10px]`，页面/面板标题最多 `text-lg`。
- 圆角：常用 `rounded-md`、`rounded-lg`；缩略图和小附件可用 `rounded-sm`；不要大圆角。
- 阴影：只给浮层和拖拽卡片，常用 `shadow-sm`、`shadow-lg`、`shadow-xl`；常规行不加阴影。
- 边框：细线为主，`border border-theme-200 dark:border-theme-700/800`；栏分隔用 `border-r` / `border-l`。
- 动效：只用短 `transition-colors`、`transition-all`、`transition-opacity`，不做复杂动画。

## 间距标尺

任务页的密度来自稳定的小间距：

- 页面/栏内部外边距：`px-2 py-1`、`px-2 py-2`、详情面板 `px-4`。
- 行内间距：`gap-1`、`gap-1.5`、`gap-2`；任务行可用 `gap-3`。
- 列表项垂直间距：容器 `space-y-px` 或 `space-y-1`。
- 弹层内容间距：`p-4 space-y-4`，菜单列表 `py-1`。
- 输入框：`px-4 py-3 text-sm`。
- 图标按钮：`p-0.5`、`p-1`、`p-1.5`、`p-2`，按重要程度递增。
- 分区标题到内容：`mb-1`、`mb-1.5`、`mb-2`。
- 模块分隔：详情内容用 `space-y-4`，模块顶部常用 `pt-4`。

不要把间距放大到 landing page 级别；`p-6` 以上在任务页通常太松。

## 布局壳

三栏任务页的视觉壳：

```tsx
<div className="flex h-full overflow-hidden">
  <aside className="border-r bg-theme-300/30 dark:bg-theme-600/30 border-theme-200 dark:border-theme-900 flex flex-col overflow-hidden" />
  <main
    className="flex flex-col overflow-hidden min-w-75 max-w-100"
    style={{ backgroundColor: 'var(--theme-bg-2)' }}
  />
  <section
    className="relative flex flex-col h-full border-l border-theme-200 dark:border-theme-700"
    style={{ backgroundColor: 'var(--theme-bg-2)' }}
  />
</div>
```

宽度偏好：

- 左侧栏：`minWidth: 215`、`maxWidth: 315`，由状态宽度控制。
- 列表视图中栏：`min-w-75 max-w-100`，style width 可联动详情宽度。
- 非列表视图中栏：`flex-1 min-w-0`。
- 详情栏：右侧完整高度，左边框分隔，不要包进卡片。

## 左侧导航

侧栏背景和边框：

```tsx
className="border-r bg-theme-300/30 dark:bg-theme-600/30 border-theme-200 dark:border-theme-900 flex flex-col overflow-hidden"
```

置顶小图标按钮：

```tsx
<div className="w-full px-2 pt-2 pb-1">
  <div className="flex flex-wrap gap-1">
    <button className="border text-sm p-1 rounded-md transition-colors border-transparent hover:bg-black/5 dark:hover:bg-theme-200/30 dark:hover:border-theme-600" />
  </div>
</div>
```

置顶选中态：

```tsx
className="border text-sm p-1 rounded-md transition-colors border-theme-300 bg-theme-100 dark:bg-theme-200/30 dark:border-theme-400"
style={{ color: 'var(--theme-text-70)' }}
```

普通导航行：

```tsx
<button className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors text-left text-sm text-theme-700 dark:text-theme-300 hover:bg-theme-700/20 dark:hover:bg-theme-200/20">
  <Icon className="w-3.5 h-3.5" />
  <span className="flex-1 truncate">Title</span>
  <span className="text-xs text-theme-600 dark:text-theme-400">3</span>
</button>
```

普通导航选中态：

```tsx
className="bg-theme-700/30 dark:bg-theme-200/30"
style={{ color: 'var(--theme-text-70)' }}
```

用户清单/进阶分组行：

```tsx
<div className="relative group flex items-center gap-1 rounded-lg transition-colors text-theme-700 dark:text-theme-300 hover:bg-white/30 dark:hover:bg-black/30">
  <button className="min-w-0 flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sm">
    <span className="shrink-0 text-sm">📁</span>
    <span className="flex-1 truncate">List name</span>
  </button>
  <span className="text-xs text-theme-400 dark:text-theme-500 group-hover:hidden pr-1">9</span>
  <button className="hidden group-hover:block p-0.5 mr-1 rounded hover:bg-theme-200 dark:hover:bg-theme-600">
    <Pencil className="w-3 h-3 text-theme-400 dark:text-theme-500" />
  </button>
</div>
```

分区标题：

```tsx
<div className="flex items-center justify-between mb-1 px-1.5 invisible hover:visible">
  <button className="flex items-center gap-1 -ms-3 text-xs font-semibold text-theme-700 dark:text-theme-300 uppercase tracking-wider hover:text-theme-700 dark:hover:text-theme-200 transition-colors">
    <ChevronDown className="w-3 h-3" />
    <p className="visible">Section</p>
  </button>
  <button className="p-0.5 rounded hover:bg-theme-100 dark:hover:bg-theme-700 transition-colors">
    <Plus className="w-3.5 h-3.5 text-theme-400 dark:text-theme-500" />
  </button>
</div>
```

## 顶部栏和设置弹层

中栏顶部：

```tsx
<div className="px-2 py-1">
  <div className="flex items-center justify-between" data-tauri-drag-region>
    <h1 className="text-lg font-bold text-theme-900 dark:text-theme-200">Title</h1>
    <button className="p-2 rounded-lg transition-colors hover:bg-theme-100">
      <MoreVertical className="w-4 h-4" />
    </button>
  </div>
</div>
```

设置弹层：

```tsx
<div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-theme-800 rounded-lg shadow-xl border border-theme-200 dark:border-theme-700 z-50 p-4 space-y-4">
  <div className="text-xs font-semibold text-theme-500 dark:text-theme-400 uppercase tracking-wider mb-1.5 block">
    Section label
  </div>
</div>
```

设置网格按钮：

```tsx
<button className="flex min-h-12 flex-col items-center justify-center gap-1 rounded px-1.5 py-1.5 text-xs transition-colors bg-theme-100 text-theme-700 hover:bg-theme-200 dark:bg-theme-700 dark:text-theme-300 dark:hover:bg-theme-600">
  <Icon className="h-4 w-4" />
  <span className="max-w-full truncate text-[10px] leading-none">Label</span>
</button>
```

设置按钮选中态：

```tsx
className="bg-theme-500 text-white"
```

网格列数：

- 视图切换：`grid grid-cols-4 gap-1`。
- 状态筛选：`grid grid-cols-3 gap-1`。
- 分组：`grid gap-1 grid-cols-4`，少一个选项时 `grid-cols-3`。

排序 wheel picker 外观：

```tsx
className="bg-white dark:bg-theme-800 text-xs text-theme-800 dark:text-theme-200"
itemHeight={32}
visibleCount={3}
```

## 内联新建任务

外壳：

```tsx
<div className="mb-1 bg-theme-100/30 dark:bg-theme-800/30 rounded-lg shadow-sm border border-theme-200 dark:border-theme-800">
  <input className="w-full px-4 py-3 text-sm text-theme-900 dark:text-theme-100 bg-transparent focus:outline-none placeholder-gray-400 dark:placeholder-gray-500" />
  <div className="flex items-center justify-between px-1 py-1.5" />
</div>
```

底部工具条：

```tsx
<div className="flex items-center gap-1">
  <button className="p-1.5 rounded transition-colors hover:bg-theme-100 dark:hover:bg-theme-700 text-theme-400 dark:text-theme-500">
    <Icon className="w-4 h-4" />
  </button>
</div>
```

有值状态：

```tsx
// 标签、日期、附件等主题色选中态
className="text-theme-500 bg-theme-50 dark:bg-theme-900/20"

// 优先级有值
className="text-orange-500 bg-orange-50 dark:bg-orange-900/20"
```

带文本的日期按钮：

```tsx
<button className="flex items-center gap-1 p-1.5 rounded transition-colors text-theme-500 bg-theme-50 dark:bg-theme-900/20">
  <Calendar className="w-4 h-4" />
  <span className="text-xs">2026-07-01 09:00</span>
</button>
```

待上传附件 chip：

```tsx
<div className="flex gap-1 flex-col px-2 pb-1.5 w-full">
  <span className="inline-flex items-center gap-1 text-xs bg-theme-50 dark:bg-theme-900/30 text-theme-600 dark:text-theme-400 px-2 py-0.5 rounded">
    filename.png
    <button className="hover:text-red-500">x</button>
  </span>
</div>
```

## 任务列表和分组

列表滚动区：

```tsx
<div className="flex-1 overflow-auto p-1">
  <div className="space-y-1" />
</div>
```

空态：

```tsx
<div className="flex flex-col items-center justify-center h-full text-theme-500 dark:text-theme-400">
  <p className="text-lg">No tasks</p>
</div>
```

分组标题：

```tsx
<button className="sticky top-0 z-10 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-theme-500 transition-colors dark:text-theme-400">
  <ChevronDown className="h-3 w-3" />
  <span className="min-w-0 flex-1 truncate">Group title</span>
  <span className="shrink-0 text-[11px] text-theme-400 dark:text-theme-500">12</span>
</button>
```

任务行：

```tsx
<div className="group flex items-center gap-3 px-2 py-2 rounded-md transition-shadow cursor-pointer">
  <CheckNow className="shrink-0" />
  <span className="flex-1 truncate text-sm text-theme-900 dark:text-theme-100">Task title</span>
  <div className="flex items-center gap-1 shrink-0" />
  <span className="text-xs font-medium shrink-0 text-green-500 dark:text-green-500">+3天</span>
</div>
```

任务行选中态：

```tsx
className="bg-theme-100/30 dark:bg-theme-800/30"
```

任务完成态：

```tsx
className="line-through text-theme-700 dark:text-theme-200"
```

逾期日期：

```tsx
className="text-xs font-medium shrink-0 text-red-500 dark:text-red-500"
```

行内进度：

```tsx
// 短条
<div className="w-10 h-1.5 bg-theme-200 dark:bg-theme-600 rounded-full overflow-hidden">
  <div className="h-full rounded-full transition-all" style={{ backgroundColor: 'var(--theme-bg-70)', width: '60%' }} />
</div>

// 圆环 SVG 尺寸
<svg className="shrink-0" height="18" width="18" />
```

## 详情面板

外壳：

```tsx
<div className="relative flex flex-col h-full border-l border-theme-200 dark:border-theme-700" style={{ backgroundColor: 'var(--theme-bg-2)' }}>
  <div className="px-4 pt-2 pb-2" />
  <div className="px-4 pb-2" />
  <div className="flex-1 overflow-auto px-4 pb-4 space-y-4" />
</div>
```

顶部日期按钮：

```tsx
<button className="flex items-center gap-2 px-2 rounded-md text-sm transition-colors bg-theme-100 dark:bg-theme-800 text-theme-600 dark:text-theme-100">
  <Calendar className="w-4 h-4 shrink-0" />
  <span className="truncate">2026-07-01</span>
</button>
```

无日期状态：

```tsx
className="text-theme-200 dark:text-theme-700 hover:bg-theme-100 dark:hover:bg-theme-700"
```

section toggle 图标：

```tsx
<button className="relative group p-1 rounded transition-colors bg-theme-100 dark:bg-theme-800 text-theme-600 dark:text-theme-100">
  <Icon className="w-4 h-4" style={{ strokeWidth: '1.5px' }} />
  <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-theme-900 dark:bg-theme-100 text-white dark:text-theme-900 text-[10px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-50">
    Tooltip
  </span>
</button>
```

详情标题输入：

```tsx
<input className="text-lg font-semibold text-theme-900 dark:text-theme-100 bg-transparent border-none outline-none flex-1 min-w-0 truncate rounded" />
```

父任务返回 link：

```tsx
<button className="flex items-center gap-1 text-xs text-theme-500 dark:text-theme-400 hover:text-theme-600 dark:hover:text-theme-400 transition-colors mt-1">
  <ChevronRight className="w-3 h-3 rotate-180 shrink-0" />
  <span className="truncate">Parent task</span>
</button>
```

进度条：

```tsx
<div className="group relative px-4 pb-2">
  <div className="w-full h-0.5 bg-theme-200 dark:bg-theme-800">
    <div className="h-full transition-all duration-300 bg-theme-300 dark:bg-theme-700" />
  </div>
  <div className="absolute left-1/2 -translate-x-1/2 -top-7 hidden group-hover:block bg-theme-900 dark:bg-theme-100 text-white dark:text-theme-900 text-xs px-2 py-0.5 rounded whitespace-nowrap">
    60%
  </div>
</div>
```

详情模块标题：

```tsx
<h3 className="text-sm font-medium text-theme-800 dark:text-theme-200">Attachments</h3>
<h3 className="flex-1 text-xs font-medium text-theme-500 dark:text-theme-400 mb-1">Linked Notes</h3>
```

模块分割：

```tsx
className="border-t border-theme-200 dark:border-theme-600 pt-4"
```

## 附件和媒体块

拖放上传 overlay：

```tsx
<div className="absolute inset-0 z-50 flex items-center justify-center bg-theme-100/80 dark:bg-theme-800/80 border-2 border-dashed border-theme-400 dark:border-theme-500 rounded-lg m-2 pointer-events-none">
  <span className="text-sm text-theme-500 dark:text-theme-400">Drop to upload</span>
</div>
```

图片附件网格：

```tsx
<div className="grid grid-cols-5 gap-2 mb-2">
  <div className="relative group aspect-square">
    <img className="w-full h-full rounded-sm border border-theme-100 object-cover cursor-pointer" />
  </div>
</div>
```

图片上传中：

```tsx
<div className="w-full h-full rounded-sm border border-theme-100 flex items-center justify-center bg-theme-50">
  <RefreshCw className="w-6 h-6 text-theme-400 animate-spin" />
</div>
```

图片失败：

```tsx
<div className="w-full h-full rounded-sm border border-red-200 flex items-center justify-center bg-red-50 relative">
  <AlertCircle className="w-6 h-6 text-red-400" />
  <span className="absolute -bottom-5 left-0 right-0 text-[10px] text-red-400 text-center truncate px-0.5">Error</span>
</div>
```

文件附件行：

```tsx
<div className="cursor-pointer flex items-center gap-2 group px-1 py-0.5 bg-theme-50 rounded hover:bg-theme-100 dark:hover:bg-theme-800">
  <File className="w-4 h-4 text-theme-400 dark:text-theme-500 shrink-0" />
  <span className="text-sm text-theme-700 dark:text-theme-300 truncate">file.pdf</span>
</div>
```

图片预览遮罩：

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-theme-900">
  <img className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
</div>
```

## 弹层和菜单

通用小弹层：

```tsx
<div className="absolute top-full left-0 mt-1 bg-white dark:bg-theme-800 rounded-lg shadow-lg border border-theme-200 dark:border-theme-700 z-50">
  ...
</div>
```

Portal 菜单：

```tsx
<div className="bg-white dark:bg-theme-800 rounded-lg shadow-lg border border-theme-200 dark:border-theme-700 py-1 min-w-45 max-h-30 overflow-y-auto">
  <button className="w-full text-left px-3 py-1.5 text-sm text-theme-700 dark:text-theme-300 hover:bg-theme-100 dark:hover:bg-theme-700 transition-colors truncate" />
</div>
```

右键菜单：

```tsx
<div className="fixed z-50 bg-white dark:bg-theme-800 rounded-lg shadow-xl border border-theme-200 dark:border-theme-700 py-1 min-w-40">
  <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-theme-700 dark:text-theme-300 hover:bg-theme-100 dark:hover:bg-theme-700 transition-colors" />
  <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-theme-100 dark:hover:bg-theme-700 transition-colors" />
</div>
```

菜单遮罩只负责关闭：

```tsx
<div className="fixed inset-0 z-50" />
```

## 看板卡片配方

看板视图允许比列表更卡片化，但仍要轻。

列：

```tsx
<div className="flex flex-col rounded-sm overflow-hidden transition-all bg-gray-50 dark:bg-gray-900">
  <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <div className="flex items-center gap-2">
      <h3 className="font-medium text-sm text-gray-900 dark:text-gray-100">Pending</h3>
      <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded-full">3</span>
    </div>
  </div>
  <div className="flex-1 overflow-auto p-2 space-y-2" />
</div>
```

列 drop hover：

```tsx
className="bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-300 dark:ring-blue-700"
```

任务卡：

```tsx
<div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
  <div className="flex items-start gap-2">
    <CheckNow className="mt-0.5 shrink-0" />
    <div className="flex-1 min-w-0">
      <h4 className="text-sm truncate text-gray-900 dark:text-gray-100">Task title</h4>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">Description</p>
      <div className="flex items-center gap-1 mt-2 text-xs text-gray-400 dark:text-gray-500">Date</div>
      <div className="flex flex-wrap gap-1 mt-2" />
    </div>
  </div>
</div>
```

卡片选中/完成/拖拽：

```tsx
className="ring-2 ring-blue-500"
className="opacity-60" // done
className="opacity-35" // dragging source
className="shadow-xl ring-1 ring-black/5 dark:ring-white/10" // drag overlay
```

标签 chip：

```tsx
<span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs text-white" style={{ backgroundColor: tag.color || '#3B82F6' }}>
  <span className="mr-0.5">🏷️</span>
  Tag
</span>
```

## 图标尺寸规则

- 导航图标：`w-3.5 h-3.5`。
- 分区折叠 chevron：`w-3 h-3`。
- 设置/工具/详情按钮图标：`w-4 h-4` 或 `h-4 w-4`。
- 附件状态大图标：`w-6 h-6`。
- 人物头像占位：`w-8 h-8 rounded-full`。
- 媒体封面：`w-14 aspect-2/3 object-cover`。

按钮里图标要 `shrink-0`，文本要 `truncate`。

## 状态边界

这部分不是视觉 token，但会影响 UI 是否一致：

- `TasksPage.tsx` 保留查询、mutation、选择状态、过滤、排序、分组、overlay/menu 回调。
- `TaskSidebar` 不拥有 `selectedListId`。
- `TaskListPane` 不拥有清单选择，只接收数据和回调。
- 分组数据保持 grouped 到渲染阶段，分组 header 和任务行一起渲染。
- 切换清单、进阶分组或智能分组时清空当前选中任务，不自动选替代项。
- 新增弹出选择器优先走 `showOverlay`，payload 用 `_source` 区分来源。
- 所有新增可见文字走 i18n key。

## 快速检查清单

交付前检查：

- 页面是否仍然是 `theme-*` 主导，而不是一套新颜色。
- 字号是否落在 `text-[10px]` / `text-xs` / `text-sm` / `text-lg` 内。
- 常规元素是否使用 `px-2`、`py-1.5`、`gap-1/2` 级别的紧凑间距。
- 是否使用 `rounded-md` / `rounded-lg`，没有大装饰卡片。
- hover、selected、active 是否低对比。
- 操作是否图标化，tooltip/title 或 i18n 文案是否完整。
- 弹层是否是白/深 theme 背景、轻边框、`shadow-lg/xl`。
- 长文本是否 `truncate`，图标是否 `shrink-0`。

## 关键源码入口

- `src/pages/TasksPage.tsx`
- `src/components/tasks/sidebar/TaskSidebar.tsx`
- `src/components/tasks/list/TaskListPane.tsx`
- `src/components/tasks/list/TaskRow.tsx`
- `src/components/tasks/detail/TaskDetailPanel.tsx`
- `src/components/tasks/controls/TaskGroupControls.tsx`
- `src/components/tasks/controls/TaskSortControls.tsx`
- `src/components/tasks/views/KanbanView.tsx`
