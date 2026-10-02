import Foundation
import PDFKit
import AppKit
guard CommandLine.arguments.count > 1 else { fatalError("Pass a PDF path") }
for filename in CommandLine.arguments.dropFirst().filter({ $0 != "--preview" }) {
    let url = URL(fileURLWithPath: filename)
    guard let document = PDFDocument(url: url) else { fatalError("PDFKit could not open \(filename)") }
    guard document.pageCount > 0 else { fatalError("No pages") }
    let text = document.string ?? ""
    guard !text.isEmpty else { fatalError("No extractable text") }
    print("\(filename): \(document.pageCount) pages; \(text.count) text characters; PDFKit read successful")
    if CommandLine.arguments.contains("--preview") {
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue }
            let image = page.thumbnail(of: NSSize(width: 900, height: 1274), for: .mediaBox)
            guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let data = bitmap.representation(using: .png, properties: [:]) else { fatalError("Unable to render preview") }
            try data.write(to: URL(fileURLWithPath: "test-results/report-page-\(index + 1).png"))
        }
    }
}
