import Cocoa

/*
  THE MENU-BAR ITEM, when `App.menuBarItem` is on.

  What it carries is the app's to decide, and both apps that have one decided the same rule:
  the item SAYS what something else decided, and decides nothing itself. Noradar's renders
  `/api/glance` from its daemon; Kinora's renders the Media Session its page already keeps. A
  menu bar claiming one thing beside a window saying another is the app printing its own bug.
  So when an app gives this a line to show, the line comes from the app's own source of truth
  (an endpoint, or a message from the page), never from a second opinion computed here.

  The icon is the app's own, taken from the bundle at the menu bar's size, in colour rather
  than as a template: a template image renders a mark on a solid plate as a solid block
  (Kinora, `MAC-09`), and an app with its own mark should not borrow an SF Symbol that a
  dozen other items already use.
*/
final class StatusItem: NSObject {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let openWindow: () -> Void

    init(openWindow: @escaping () -> Void) {
        self.openWindow = openWindow
        super.init()
        if let icon = NSApp.applicationIconImage.copy() as? NSImage {
            icon.size = NSSize(width: 18, height: 18)
            item.button?.image = icon
        } else {
            item.button?.title = App.name
        }
        item.button?.toolTip = App.name

        let menu = NSMenu()
        let open = NSMenuItem(title: "Open \(App.name)", action: #selector(open), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit \(App.name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
    }

    @objc private func open() { openWindow() }

    /// Whether a line has been drawn beside the icon, so `unknown` does not invent one for an
    /// app whose item never carries a line.
    private var saying = false

    /// The line beside the icon and its tooltip, as the app's source of truth gave them. The
    /// app's own code calls this — a message relay from the page, or a reading of an endpoint —
    /// and decides what the words are. `""` is a quiet reading (Linora's zero waiting on review):
    /// it draws the icon alone, but it is still a line, so `unknown` replaces it with a dash.
    /// nil means the item carries no line at all, and `unknown` leaves it alone.
    func say(_ line: String?, tip: String? = nil) {
        guard let button = item.button else { return }
        button.imagePosition = .imageLeading
        // An empty line draws no text rather than a stray space (`LIN-63`).
        button.title = line.map { $0.isEmpty ? "" : " \($0)" } ?? ""
        button.toolTip = tip ?? App.name
        saying = line != nil
    }

    /*
      The page that gave the line is gone: the failure page stands in for it, and a page that
      is not loaded cannot send the null that would say so (Linora, `MAC-01`'s known gap). So
      the shell says it for the page — a dash, never the last line, which would read as current.
      The next line from the page replaces it.
    */
    func unknown() {
        guard saying else { return }
        say("–", tip: "\(App.name): not known while \(App.name) is not loaded")
    }
}
