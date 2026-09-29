import { For, Show } from "solid-js";

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

/** 只读履历：改数（旧值→新值）与结清（吃值→结论）均可对照。任何角色都不能在此改数。 */
export default function RevisionTimeline(props) {
  const revisions = () => props.revisions || [];

  return (
    <div class="timeline">
      <Show when={revisions().length} fallback={<p class="hint">暂无改数 / 结清履历</p>}>
        <For each={revisions()}>
          {(r) => (
            <div class="timeline-item">
              <div class="timeline-head">
                <span class="kind-tag" data-kind={r.kind}>
                  {r.kind_label || r.kind}
                </span>
                <span class="hint">{fmtTime(r.created_at)}</span>
              </div>
              <div class="timeline-body">
                <Show
                  when={r.kind === "revise"}
                  fallback={
                    <span>
                      按改后刀补 <strong>{r.offset_before} µm</strong> 结清，结论：
                      <strong class={r.verdict === "合格" ? "pass" : "fail"}>
                        {r.verdict || "—"}
                      </strong>
                    </span>
                  }
                >
                  <span>
                    刀补 <strong>{r.offset_before} µm</strong> →{" "}
                    <strong>{r.offset_after} µm</strong>
                  </span>
                </Show>
                <Show when={r.operator}>
                  <span class="hint">操作人：{r.operator}</span>
                </Show>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
