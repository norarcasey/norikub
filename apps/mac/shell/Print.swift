import Cocoa
import WebKit

/*
  PRINTING, which a `WKWebView` leaves undone: `window.print` does nothing, and a print
  operation ignores the page's `@page` rule. `print.js` has the measurements (Bingora,
  `BINGO-7`).

  The page decides the paper and the shell applies it. What the page did not say stays as the
  printer has it, and the print panel is shown every time, so the paper, the printer and Save
  as PDF are still the person's to change.

  A page with no Print button and no `@page` rule loses nothing: ⌘P prints it on the printer's
  paper, as Safari would.
*/
struct PageSetup: Equatable {
    /// Portrait width and height in points, or nil for the printer's own paper.
    var paper: NSSize?
    var landscape: Bool?
    /// Top, right, bottom, left in points, each nil where the page did not say.
    var margins: [CGFloat?]

    static let unsaid = PageSetup(paper: nil, landscape: nil, margins: [nil, nil, nil, nil])

    /// What `page()` in `print.js` returned. Anything else is `unsaid`, never a guess.
    init(page value: Any?) {
        self = .unsaid
        guard let dict = value as? [String: Any] else { return }
        if let paper = dict["paper"] as? [String: Any], let width = Self.points(paper["width"]),
           let height = Self.points(paper["height"]), width > 0, height > 0 {
            self.paper = NSSize(width: width, height: height)
        }
        landscape = dict["landscape"] as? Bool
        if let margins = dict["margins"] as? [String: Any] {
            self.margins = ["top", "right", "bottom", "left"].map { Self.points(margins[$0]) }
        }
    }

    init(paper: NSSize?, landscape: Bool?, margins: [CGFloat?]) {
        self.paper = paper
        self.landscape = landscape
        self.margins = margins
    }

    private static func points(_ value: Any?) -> CGFloat? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let points = CGFloat(number.doubleValue)
        return points.isFinite && points >= 0 ? points : nil
    }

    /// The printer's settings with what the page said laid over them. The paper goes in before
    /// the orientation: NSPrintInfo turns the paper itself when the orientation is set.
    func applied(to base: NSPrintInfo) -> NSPrintInfo {
        let info = (base.copy() as? NSPrintInfo) ?? NSPrintInfo()
        if let paper { info.paperSize = paper }
        if let landscape { info.orientation = landscape ? .landscape : .portrait }
        if let top = margins[0] { info.topMargin = top }
        if let right = margins[1] { info.rightMargin = right }
        if let bottom = margins[2] { info.bottomMargin = bottom }
        if let left = margins[3] { info.leftMargin = left }
        return info
    }

    var said: String {
        let paper = self.paper.map { "\(Int($0.width.rounded()))×\(Int($0.height.rounded())) pt" } ?? "the printer's paper"
        let turned = landscape.map { $0 ? "landscape" : "portrait" } ?? "the printer's orientation"
        let margins = self.margins.map { $0.map { String(Int($0.rounded())) } ?? "default" }.joined(separator: " ")
        return "\(paper), \(turned), margins \(margins)"
    }
}

enum Printing {
    static let channel = "shellPrint"
    static let namespace = "__shellPrint"

    /// The page's rule read now, not at load: the stylesheet is the page's, and can change.
    static func run(_ web: WKWebView, in window: NSWindow) {
        web.evaluateJavaScript("\(namespace)?.page()") { value, error in
            if let error { log("could not read the page's @page rule: \(error.localizedDescription)") }
            let setup = PageSetup(page: value)
            log("printing on \(setup.said)")
            let operation = web.printOperation(with: setup.applied(to: NSPrintInfo.shared))
            operation.showsPrintPanel = true
            operation.showsProgressPanel = true
            operation.printPanel.options.formUnion([.showsPaperSize, .showsOrientation, .showsScaling, .showsPreview])
            /*
              As a sheet, never `run()`. In the probe, `run()` on the main thread never returned,
              and its own 40 s timeout on the same thread never fired either; the sheet printed
              Bingora's board whole, landscape, on one page.
            */
            operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        }
    }
}

/// The page's print, from `print.js`. Weak, as `Relay` is, so the content controller's strong
/// hold does not decide the shell's lifetime.
final class PrintRelay: NSObject, WKScriptMessageHandler {
    private weak var shell: Shell?
    init(_ shell: Shell) { self.shell = shell }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        shell?.printPage()
    }
}
