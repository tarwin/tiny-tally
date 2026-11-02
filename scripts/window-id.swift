// Prints the window number of the app's on-screen window, titled "<books> —
// Tiny Tally" or "Tiny Tally" (for `screencapture -l`). Used by
// screenshots.sh. Only the end of the title counts: a terminal's title can
// mention the app too.
import CoreGraphics
let want = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Tiny Tally"
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowLayer as String] as? Int) == 0 {
  if let name = w[kCGWindowName as String] as? String, name == want || name.hasSuffix("— \(want)"), let id = w[kCGWindowNumber as String] as? Int {
    print(id)
    break
  }
}
