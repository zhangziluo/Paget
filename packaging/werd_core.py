"""Entry point for the frozen reading core (the `werd-core` sidecar).

PyInstaller needs a **script** to freeze, and `wreader/serve.py` cannot play that
role: it starts with relative imports (`from . import config, library, ...`),
which only resolve when the file is imported as part of its package, not when it
is executed as `__main__`.  This launcher imports it absolutely instead, so the
frozen binary runs exactly the same code as `python -m wreader.serve` -- same
handlers, same `~/.wreader` files, same protocol on stdin/stdout.
"""

# 无头内核的协议循环：与服务端 python -m wreader.serve 是同一个函数
from wreader.serve import main

# 退出码沿用内核的返回值（正常读到 stdin EOF 就是 0，让 Rust 侧收尸时能看到干净退出）
raise SystemExit(main())
