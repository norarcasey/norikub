import Cocoa
import UniformTypeIdentifiers
import WebKit

/*
  A `blob:` LINK OPENS AS A FILE, in the Mac app the file's type opens in.

  Handed to `NSWorkspace`, a blob URL is a URL nothing on the Mac can open: it lives only in the
  web view's process, and macOS answers "There is no application set to open the URL blob:…",
  whose Choose Application… cannot pick anything either (Linora's attachments, `LIN/LIN-89`).
  So the page reads the blob for us (`open.js`), and the bytes are written to a file of their
  own and opened from there — a screenshot in Preview, a `.md` in whatever opens Markdown.

  Each file gets a new folder in the temporary directory, so two files of one name never meet
  and a copy already open is never written over. It is made read-only: an edit to it would reach
  nothing, and the app opening it says so rather than letting it look saved.
*/
enum Opening {
    static let namespace = "__shellOpen"

    /// Only a link the person pressed reaches here (`Boundary`), never a page's script alone.
    static func run(_ url: URL, from web: WKWebView) {
        // The URL goes in as an argument, never into the source: nothing from the page is code.
        web.callAsyncJavaScript("return await globalThis.\(namespace)?.read(url) ?? null",
                                arguments: ["url": url.absoluteString], in: nil, in: .page) { result in
            switch result {
            case .failure(let error):
                // The page's own message, which "A JavaScript exception occurred" is not: the
                // first version's failure said only that, and the cause was in this key
                // (`LIN/LIN-89`).
                let ns = error as NSError
                let why = ns.userInfo["WKJavaScriptExceptionMessage"] as? String ?? ns.localizedDescription
                log("could not read \(url.absoluteString) from the page: \(why)")
            case .success(let value):
                guard let dict = value as? [String: Any], let encoded = dict["data"] as? String,
                      let data = Data(base64Encoded: encoded) else {
                    return log("the page had no file at \(url.absoluteString); open.js may be missing")
                }
                let name = filename(dict["name"] as? String ?? "", type: dict["type"] as? String ?? "")
                do {
                    let file = try write(data, as: name)
                    log("opening \(name), \(data.count) bytes")
                    NSWorkspace.shared.open(file)
                } catch {
                    log("could not write \(name) to open it: \(error.localizedDescription)")
                }
            }
        }
    }

    /// A name the file system takes: no folders, not hidden, never empty, with an extension
    /// from the type when the name has none, since the extension is what picks the app.
    static func filename(_ called: String, type: String) -> String {
        var name = called.components(separatedBy: CharacterSet(charactersIn: "/:\0")).joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while name.hasPrefix(".") { name.removeFirst() }
        name = String(name.prefix(200))
        if name.isEmpty { name = "attachment" }
        if (name as NSString).pathExtension.isEmpty,
           let ext = UTType(mimeType: type)?.preferredFilenameExtension {
            name += ".\(ext)"
        }
        return name
    }

    private static func write(_ data: Data, as name: String) throws -> URL {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(App.name) files", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent(name)
        try data.write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o444], ofItemAtPath: file.path)
        return file
    }
}
