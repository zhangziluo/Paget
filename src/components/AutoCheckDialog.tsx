/**
 * 「人还在吗」的校验题 —— 自动翻页连着翻久了才弹（文字与图片阅读页共用）。
 *
 * 与终端同一条规矩（见 `core/wreader/reader.py` 的 `resolve_auto_check`）：**点哪一个都算作答**，
 * 题只证明人还在桌前，不考算术；倒计时走完（或按「停下」）就停掉自动翻页，由调用方
 * 说明原因。所以这里只有一个「作答」回调，不判断对错 —— 那正是它想表达的意思。
 */
import type { AutoCheck } from "../lib/autoTurn";

export default function AutoCheckDialog(props: {
  /** 题目（`lib/autoTurn.ts` 的 `makeAutoCheck` 出题） */
  question: AutoCheck;
  /** 还剩几秒（心跳每 250 ms 刷新一次） */
  remaining: number;
  /** 点任一选项：算作答，继续自动翻页 */
  onAnswer: () => void;
  /** 主动停下（等价于"没作答"） */
  onStop: () => void;
}) {
  return (
    <div className="auto-check" role="dialog" aria-modal="true" aria-label="自动翻页校验">
      <div className="auto-check-box">
        <p className="dim">自动翻页已经连着翻了一会儿 —— 人还在吗？</p>
        {/* 题目本身：随便算一下就行，点任一选项都能继续 */}
        <p className="auto-check-prompt">{props.question.prompt} = ?</p>
        <div className="auto-check-choices">
          {props.question.choices.map((choice) => (
            <button key={choice} className="ghost" onClick={props.onAnswer}>
              {choice}
            </button>
          ))}
        </div>
        <p className="dim auto-check-foot">
          <span>
            {Math.max(0, Math.ceil(props.remaining))} 秒内点任意一个都能继续
          </span>
          <button className="ghost" onClick={props.onStop}>
            停下自动翻页
          </button>
        </p>
      </div>
    </div>
  );
}
