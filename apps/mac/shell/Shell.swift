import Cocoa
import WebKit

/*
  A native Mac window around the web app. It is not a second client: it loads the same
  `apps/web` build the browser and the phone load, so there is one contract, one set of rules
  and one offline story. What the shell adds is what a browser tab cannot have — a real app
  with the app's own name, icon, menus and notifications — and what a bare `WKWebView` does
  not do for itself, each of which failed silently in an app before this layer existed.

  Lifted from Noradar (`apps/mac`, `OPS-05`) and Kinora (`apps/mac`, `MAC-01` to `MAC-04`).
  The fixes they paid for are kept here with the measurement that found each one; a shell
  without them works on the first launch and fails on the second.
*/

struct TargetError: Error {
    let why: String
}

final class Shell: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let home: URL
    private let boundary: Boundary
    private let provenance = Provenance.fromBundle()
    private var window: NSWindow?
    private var web: WKWebView?
    private var notifier: Notifier?
    private var status: StatusItem?

    init(home: URL) {
        self.home = home
        self.boundary = Boundary(home: home, inside: App.inside)
        super.init()
    }

    /// `--url` or `App.home`, refused rather than guessed at when either is not a URL.
    static func target(_ argv: [String]) -> Result<URL, TargetError> {
        let raw: String
        if let at = argv.firstIndex(of: "--url") {
            guard at + 1 < argv.count else { return .failure(TargetError(why: "--url needs a URL")) }
            raw = argv[at + 1]
        } else {
            raw = App.home
        }
        guard let url = URL(string: raw), let scheme = url.scheme, ["http", "https"].contains(scheme),
              url.host != nil
        else { return .failure(TargetError(why: "not an http(s) URL: \(raw)")) }
        return .success(url)
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        log("launched, built from \(provenance?.commit ?? "an unstamped build")")
        /*
          Built before anything else, because it sets the notification centre's delegate: a
          click on a banner that launched the app is delivered during launch, and to nobody if
          the delegate is not set by the time launching finishes.
        */
        let notifier = Notifier(tell: { [weak self] call in self?.reachBack(call) },
                                openWindow: { [weak self] in self?.showWindow() })
        self.notifier = notifier

        let config = WKWebViewConfiguration()
        /*
          PERSISTENT, said out loud rather than inherited. The session, the row cache and the
          service worker all live in this store; Kinora measured (`MAC-01`) that with an
          ephemeral one every launch reads as a first run — signed out, nothing cached, no
          offline start — and looks exactly like an app that forgets you.
        */
        config.websiteDataStore = .default()
        if let script = Self.resource("notify", "js") {
            config.userContentController.add(Relay(notifier), name: Notifier.channel)
            config.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        } else {
            // Without it the page keeps the engine's own Notification, which answers denied for
            // ever (Kinora, macOS 26): the page will say notifications are off, and that is true.
            log("notify.js is missing from the bundle; notifications will not work")
        }
        if let script = Self.resource("print", "js") {
            config.userContentController.add(PrintRelay(self), name: Printing.channel)
            config.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        } else {
            log("print.js is missing from the bundle; the page's Print will do nothing, and File > Print prints on the printer's paper")
        }
        // No channel: the shell asks, when a blob link is pressed (`Open.swift`).
        if let script = Self.resource("open", "js") {
            config.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        } else {
            log("open.js is missing from the bundle; an attached file's link will open nothing")
        }
        // Before the web view exists, so an app whose item takes its line from the page can
        // register that channel here: a handler added to a configuration already in use is
        // not seen by the page (Linora, `MAC-01`).
        if App.menuBarItem {
            let status = StatusItem(openWindow: { [weak self] in self?.showWindow() })
            boundary.pageGone = { [weak status] in status?.unknown() }
            self.status = status
        }

        let frame = NSRect(x: 0, y: 0, width: 1200, height: 820)
        let web = WKWebView(frame: frame, configuration: config)
        web.navigationDelegate = boundary
        web.uiDelegate = boundary
        web.allowsBackForwardNavigationGestures = true
        self.web = web

        let window = NSWindow(contentRect: frame,
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = App.name
        window.contentView = web
        window.minSize = NSSize(width: 420, height: 480)
        /*
          A window made in code releases itself on close, and under ARC this property is then a
          pointer to a freed window: the next Open is a crash. Noradar found it the day closing
          and reopening became the ordinary way to use the app (`OPS-05`). Hidden, not released,
          also keeps the page alive behind a closed window — a sync still finishing, a
          notification still able to arrive.
        */
        window.isReleasedWhenClosed = false
        window.delegate = self
        // Centred FIRST: the autosave name restores the saved frame as it is set, and a
        // `center()` after it moved the window back to the middle on every launch.
        window.center()
        window.setFrameAutosaveName("\(App.name)Main")
        self.window = window
        boundary.window = window
        boundary.web = web

        NSApp.mainMenu = Menus.build(target: self, provenance: provenance)

        web.load(URLRequest(url: home))
        showWindow()
    }

    // MARK: The window

    func showWindow() {
        // Regular before ordering front, or the window comes up behind whatever is in front
        // and without a menu bar of its own.
        NSApp.setActivationPolicy(.regular)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Closing the window is not quitting. The app is still what receives a notification, and
    /// the page behind the window may still be working.
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    func windowWillClose(_ note: Notification) {
        guard App.menuBarItem else { return }
        // Asynchronously: changing the policy inside windowWillClose runs while AppKit is still
        // tearing the window down. Without a menu-bar item the Dock icon is the way back, so
        // the app stays `.regular`.
        DispatchQueue.main.async { NSApp.setActivationPolicy(.accessory) }
    }

    /// The Dock icon clicked, or `open -a` on an app already running.
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows visible: Bool) -> Bool {
        showWindow()
        return true
    }

    /// Two things can change while this runs and nothing tells the app: Notifications in
    /// System Settings, and the sources the bundle was built from. Coming forward is the
    /// cheapest moment reliably after either, so both are read again then — the menu is rebuilt
    /// so its build line is today's answer, not the one from launch.
    func applicationDidBecomeActive(_ note: Notification) {
        notifier?.refresh()
        NSApp.mainMenu = Menus.build(target: self, provenance: provenance)
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: What the menus call

    @objc func reload() {
        guard let web else { return }
        boundary.reload(web)
    }

    /// File > Print and the page's own `window.print`, one path, so both print on the page's paper.
    @objc func printPage() {
        guard let web, let window else { return }
        showWindow()
        Printing.run(web, in: window)
    }

    @objc func reloadFromOrigin() { web?.reloadFromOrigin() }
    @objc func goBack() { web?.goBack() }
    @objc func goForward() { web?.goForward() }
    @objc func zoomIn() { web.map { $0.pageZoom = min($0.pageZoom + 0.1, 3) } }
    @objc func zoomOut() { web.map { $0.pageZoom = max($0.pageZoom - 0.1, 0.5) } }
    @objc func actualSize() { web?.pageZoom = 1 }

    /// Nothing is run on anybody's behalf: the command goes to the clipboard.
    @objc func copyInstall() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("pnpm app:install", forType: .string)
    }

    /// In Console.app, which is what macOS opens a `.log` with, and which follows it as it grows.
    @objc func openLog() { NSWorkspace.shared.open(Log.file) }

    // MARK: Helpers

    /// One call on the notifier's namespace in the page. Optional-chained, because a banner
    /// clicked while the page is mid-load would otherwise throw about a state that is merely
    /// early.
    private func reachBack(_ call: String) {
        web?.evaluateJavaScript("\(Notifier.namespace)?.\(call)")
    }

    static func resource(_ name: String, _ ext: String) -> String? {
        guard let at = Bundle.main.url(forResource: name, withExtension: ext) else { return nil }
        return try? String(contentsOf: at, encoding: .utf8)
    }
}

/// `WKUserContentController` holds its handlers strongly. A relay keeps that from being the
/// thing that decides the notifier's lifetime.
final class Relay: NSObject, WKScriptMessageHandler {
    private weak var notifier: Notifier?
    init(_ notifier: Notifier) { self.notifier = notifier }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        notifier?.handle(NotifyRequest(body: message.body))
    }
}

/*
  SAID ON STDERR AND IN `~/Library/Logs/<App.name>.log`, because a Dock or login launch throws
  stderr away. On 12 Oct 2026 Nora asked whether notifications were working, and for Linora and
  Kinora nothing on disk could say. Noradar could answer only because its app writes a file
  (`LIN/LIN-53`). It is the macOS logs folder and not the app's own home, because a hosted app
  has no home on this laptop, and Console.app already lists it there. The file is bounded by
  rolling over to `.log.1` at launch once it passes a megabyte. Each time the app comes forward
  it writes one permission line, about 80 bytes, so a megabyte is months.
*/
enum Log {
    static let file = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/\(App.name).log")
    private static let cap = 1_000_000
    // Serial, because some lines are said from a notification-centre callback off the main thread.
    private static let queue = DispatchQueue(label: "\(App.name).log")
    private static let handle: FileHandle? = open()
    // Local time with its offset: the file is read by a person asking about this afternoon.
    private static let stamp: ISO8601DateFormatter = {
        let format = ISO8601DateFormatter()
        format.timeZone = .current
        return format
    }()

    static func write(_ line: String) {
        let at = Date()
        queue.async {
            FileHandle.standardError.write(Data("\(App.name.lowercased()): \(line)\n".utf8))
            handle?.write(Data("\(stamp.string(from: at)) \(line)\n".utf8))
        }
    }

    private static func open() -> FileHandle? {
        let files = FileManager.default
        try? files.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let size = (try? files.attributesOfItem(atPath: file.path))?[.size] as? Int, size > cap {
            let previous = file.appendingPathExtension("1")
            try? files.removeItem(at: previous)
            try? files.moveItem(at: file, to: previous)
        }
        if !files.fileExists(atPath: file.path) { files.createFile(atPath: file.path, contents: nil) }
        guard let handle = try? FileHandle(forWritingTo: file) else {
            FileHandle.standardError.write(Data("\(App.name.lowercased()): cannot write \(file.path)\n".utf8))
            return nil
        }
        _ = try? handle.seekToEnd()
        return handle
    }
}

func log(_ line: String) { Log.write(line) }
