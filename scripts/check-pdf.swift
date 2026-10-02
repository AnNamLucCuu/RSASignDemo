import Foundation
import PDFKit
guard CommandLine.arguments.count > 1 else { fatalError("Pass a PDF path") }
for filename in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: filename)
    guard let document = PDFDocument(url: url) else { fatalError("PDFKit could not open \(filename)") }
    guard document.pageCount > 0 else { fatalError("No pages") }
    let text = document.string ?? ""
    guard !text.isEmpty else { fatalError("No extractable text") }
    print("\(filename): \(document.pageCount) pages; \(text.count) text characters; PDFKit read successful")
}
