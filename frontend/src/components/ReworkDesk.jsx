import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { fetchSubmission, fetchSubmissions, reviseSubmission } from "../api";
import RevisionTimeline from "./RevisionTimeline";

/**
 * 重投台：三段式
 *  1) 待改列表 —— 仅「待复核」行；已被领走（复核中）/ 已结清的不出现
 *  2) 改数区   —— 仅操作员，选中待改行后输新值确认；撞车时服务端明确失败
 *  3) 履历详情 —— 选中行的旧值→新值与结清结论；复核员只读
 */
export default function ReworkDesk(props) {
  const canWrite = () => props.user.can_write;

  const [pending, setPending] = createSignal([]);
  const [selected, setSelected] = createSignal(null);
  const [newOffset, setNewOffset] = createSignal("");
  const [message, setMessage] = createSignal({ type: "", text: "" });
  const [saving, setSaving] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  let timer = null;

  async function loadList(keepSelected = true) {
    setLoading(true);
    try {
      const all = await fetchSubmissions();
      setPending(all.filter((r) => r.status === "pending"));
      if (keepSelected && selected()) {
        await loadDetail(selected().id, { silent: true });
      }
    } catch (e) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id, opts = {}) {
    try {
      const d = await fetchSubmission(id);
      setSelected(d);
      // 选中行已被认领 / 结清：清空改数区，绝不留半截
      if (d.status !== "pending") setNewOffset("");
    } catch (e) {
      if (!opts.silent) setMessage({ type: "error", text: e.message });
    }
  }

  async function selectRow(row) {
    setMessage({ type: "", text: "" });
    setNewOffset("");
    await loadDetail(row.id);
  }

  async function confirmRework(e) {
    e.preventDefault();
    const d = selected();
    if (!d || d.status !== "pending") return;
    const value = Number(newOffset());
    if (!Number.isInteger(value)) {
      setMessage({ type: "error", text: "请输入整数刀补（微米）" });
      return;
    }
    setSaving(true);
    setMessage({ type: "", text: "" });
    try {
      const updated = await reviseSubmission(d.id, value);
      setSelected(updated);
      setNewOffset("");
      setMessage({
        type: "ok",
        text: `改数成功：${d.tool_code} ${d.offset_um} µm → ${updated.offset_um} µm，已重新排队待复核`,
      });
      await loadList();
    } catch (err) {
      // 撞车唯一结局：认领先成则改数明确失败，刷新后该行离开待改列表
      setMessage({ type: "error", text: `改数失败：${err.message}` });
      await loadList();
    } finally {
      setSaving(false);
    }
  }

  onMount(() => {
    loadList(false);
    timer = setInterval(() => loadList(true), 2500);
  });
  onCleanup(() => timer && clearInterval(timer));

  const editableRow = () =>
    canWrite() && selected() && selected().status === "pending" ? selected() : null;

  return (
    <div class="rework">
      <section class="card">
        <div class="toolbar">
          <h2>待改列表（待复核）</h2>
          <button type="button" class="ghost" onClick={() => loadList()} disabled={loading()}>
            {loading() ? "刷新中…" : "刷新"}
          </button>
        </div>
        <p class="hint">只有仍在排队、未被领走的行能改数重投；进入复核中或已结清的行不再出现。</p>
        <table>
          <thead>
            <tr>
              <th>刀具</th>
              <th>当前刀补 µm</th>
              <th>提交时间</th>
              <th>已改次数</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <For each={pending()} fallback={<tr><td colspan="5" class="hint">暂无待改行</td></tr>}>
              {(row) => (
                <tr classList={{ selected: selected() && selected().id === row.id }}>
                  <td>{row.tool_code}</td>
                  <td>{row.offset_um}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{(row.revisions || []).filter((r) => r.kind === "revise").length}</td>
                  <td>
                    <button type="button" class="ghost" onClick={() => selectRow(row)}>
                      {canWrite() ? "选中改数" : "查看履历"}
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>

      <div class="rework-split">
        <section class="card">
          <h2>改数区</h2>
          <Show
            when={canWrite()}
            fallback={<p class="hint">复核员只读：可查看下方履历，不能改数字。</p>}
          >
            <Show
              when={editableRow()}
              fallback={
                <p class="hint">
                  {selected()
                    ? selected().status === "pending"
                      ? "准备中…"
                      : "该行已被领走或已结清，不能再改数。"
                    : "请在左侧待改列表选中一行进行改数。"}
                </p>
              }
            >
              {(row) => (
                <form class="form" onSubmit={confirmRework}>
                  <p class="hint">
                    刀具 <strong>{row().tool_code}</strong>（编号 {row().id}）· 当前刀补{" "}
                    <strong>{row().offset_um} µm</strong>
                  </p>
                  <label>
                    新刀补（微米，整数）
                    <input
                      type="number"
                      step="1"
                      value={newOffset()}
                      onInput={(e) => setNewOffset(e.currentTarget.value)}
                      placeholder={`不同于当前值 ${row().offset_um}`}
                      required
                    />
                  </label>
                  <button type="submit" disabled={saving()}>
                    {saving() ? "提交中…" : "确认改数并重投"}
                  </button>
                </form>
              )}
            </Show>
          </Show>
          <Show when={message().text}>
            <div class={`banner ${message().type === "ok" ? "ok" : "error"}`}>
              {message().text}
            </div>
          </Show>
        </section>

        <section class="card">
          <div class="toolbar">
            <h2>履历详情</h2>
          </div>
          <Show
            when={selected()}
            fallback={<p class="hint">选中一行后在此查看改数与结清履历。</p>}
          >
            {(d) => (
              <>
                <div class="detail-grid">
                  <p>
                    刀具：{d().tool_code} · 当前刀补：<strong>{d().offset_um} µm</strong>
                  </p>
                  <p>
                    状态：{({ pending: "待复核", processing: "复核中", done: "已完成" })[d().status] || d().status}
                    ｜结论：
                    <span class={d().verdict === "合格" ? "pass" : d().verdict === "超差" ? "fail" : ""}>
                      {d().verdict || "—"}
                    </span>
                  </p>
                </div>
                <RevisionTimeline revisions={d().revisions} />
              </>
            )}
          </Show>
        </section>
      </div>
    </div>
  );
}
