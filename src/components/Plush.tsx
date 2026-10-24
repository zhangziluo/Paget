/**
 * 一只毛绒玩具的骨架：尾巴 → 身子（含浅色肚皮）→ 四肢 → 耳朵 → 头（缝线 + 点眼 + 鼻子）。
 *
 * 这里只摆结构，具体长什么样完全交给 CSS 的 `.plush-<id>`（见 App.css）——
 * 和留声机、收音机一样是纯 CSS 塑形，不用任何图片。
 * 传了 *label* 就是一张有名字的图（书架上的那只 / 阅读页蹦出来的那只）；
 * 不传就当纯装饰（面板里的小图标）。
 *
 * **只有「朝前」一种造型** —— 从前还能朝左 / 朝右 / 朝后（`data-facing` 换一套画法），
 * 2026-10-10 按用户要求把那三面去掉了，所以那个属性也没了。
 *
 * **2026-10-24 从 `views/Shelf.tsx` 抽出来**成独立组件：阅读页右下角蹦出来的玩偶也要用它，
 * 放在 `components/` 里两边一起 import，省得各画一份、迟早跑偏。
 *
 * `looking`：阅读页里玩偶从右下探出头，要「眼睛往书页那边看过去」—— 传它就加一个
 * `.plush-looking` 类，CSS 把两颗眼珠朝书页方向挪一点。
 */
export function Plush(props: { id: string; label?: string; looking?: boolean }) {
  return (
    <span
      className={`plush plush-${props.id}${props.looking ? " plush-looking" : ""}`}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    >
      {/* 尾巴：从身子后面探出来 */}
      <span className="plush-tail" />
      {/* 身子 + 浅色肚皮（一眼看出"有身体"） */}
      <span className="plush-body">
        <span className="plush-belly" />
      </span>
      {/* 前爪（猫头鹰是翅膀、乌龟是前鳍） */}
      <span className="plush-arm l" />
      <span className="plush-arm r" />
      {/* 后脚（乌龟是后鳍） */}
      <span className="plush-leg l" />
      <span className="plush-leg r" />
      {/* 头 + 耳朵绑成一组：管理模式下抬头 / 转头 / 缩头都动这一层 ——
          头和耳朵因此永远是一个整体（见 App.css 的 `.plush-head-group`）。
          这一层本身不画东西，尺寸与 `.plush` 一致，所以里面的定位一字不变。 */}
      <span className="plush-head-group">
        {/* 耳朵（乌龟没有耳朵，CSS 里藏掉） */}
        <span className="plush-ear l" />
        <span className="plush-ear r" />
        {/* 头：缝线、点眼、鼻子都在脸上 */}
        <span className="plush-head">
          <span className="plush-stitch" />
          <span className="plush-eye l" />
          <span className="plush-eye r" />
          <span className="plush-snout" />
        </span>
      </span>
    </span>
  );
}

export default Plush;
