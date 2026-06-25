import AppKit
import CoreImage
import Foundation
import Vision

func writeError(_ message: String) {
  if let data = "\(message)\n".data(using: .utf8) {
    FileHandle.standardError.write(data)
  }
}

guard CommandLine.arguments.count >= 2 else {
  writeError("Usage: vision-ocr.swift <image-path> [language-id,language-id]")
  exit(2)
}

let imagePath = CommandLine.arguments[1]
let languageArgument = CommandLine.arguments.count >= 3 ? CommandLine.arguments[2] : ""
let outputMode = ProcessInfo.processInfo.environment["OCR_VISION_OUTPUT"] ?? "text"

guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  writeError("Failed to load image for OCR: \(imagePath)")
  exit(2)
}

struct OcrTextBox: Encodable {
  let text: String
  let confidence: Float
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct OcrJsonOutput: Encodable {
  let width: Int
  let height: Int
  let boxes: [OcrTextBox]
}

func envCGFloat(_ key: String, fallback: CGFloat, min minValue: CGFloat, max maxValue: CGFloat) -> CGFloat {
  guard let rawValue = ProcessInfo.processInfo.environment[key],
        let value = Double(rawValue) else {
    return fallback
  }
  return min(max(CGFloat(value), minValue), maxValue)
}

func applyFilter(_ name: String, to image: CIImage, parameters: [String: Any]) -> CIImage {
  guard let filter = CIFilter(name: name) else {
    return image
  }
  filter.setValue(image, forKey: kCIInputImageKey)
  for (key, value) in parameters {
    filter.setValue(value, forKey: key)
  }
  return filter.outputImage ?? image
}

func preprocessedImage(_ cgImage: CGImage) -> CGImage {
  let scale = envCGFloat("OCR_VISION_SCALE", fallback: 2.0, min: 1.0, max: 4.0)
  let contrast = envCGFloat("OCR_VISION_CONTRAST", fallback: 1.55, min: 1.0, max: 2.5)
  let sharpness = envCGFloat("OCR_VISION_SHARPNESS", fallback: 0.35, min: 0.0, max: 1.5)

  var image = CIImage(cgImage: cgImage)

  if scale > 1.0 {
    image = applyFilter(
      "CILanczosScaleTransform",
      to: image,
      parameters: [
        kCIInputScaleKey: scale,
        kCIInputAspectRatioKey: 1.0
      ]
    )
  }

  image = applyFilter(
    "CIColorControls",
    to: image,
    parameters: [
      kCIInputSaturationKey: 0.0,
      kCIInputContrastKey: contrast,
      kCIInputBrightnessKey: 0.0
    ]
  )

  if sharpness > 0 {
    image = applyFilter(
      "CISharpenLuminance",
      to: image,
      parameters: [
        kCIInputSharpnessKey: sharpness
      ]
    )
  }

  let context = CIContext(options: [.useSoftwareRenderer: false])
  let extent = image.extent.integral
  return context.createCGImage(image, from: extent) ?? cgImage
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let languages = languageArgument
  .split(separator: ",")
  .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
  .filter { !$0.isEmpty }
  .sorted { left, right in
    languagePriority(left) < languagePriority(right)
  }

if !languages.isEmpty {
  request.recognitionLanguages = languages
}

let processedCgImage = preprocessedImage(cgImage)
let handler = VNImageRequestHandler(cgImage: processedCgImage, options: [:])

do {
  try handler.perform([request])
  let results = request.results ?? []
  if outputMode == "json" {
    let imageWidth = Double(cgImage.width)
    let imageHeight = Double(cgImage.height)
    let boxes = results.compactMap { observation -> OcrTextBox? in
      guard let candidate = observation.topCandidates(1).first else {
        return nil
      }
      let box = observation.boundingBox
      return OcrTextBox(
        text: candidate.string,
        confidence: candidate.confidence,
        x: box.minX * imageWidth,
        y: (1.0 - box.maxY) * imageHeight,
        width: box.width * imageWidth,
        height: box.height * imageHeight
      )
    }
    let output = OcrJsonOutput(width: cgImage.width, height: cgImage.height, boxes: boxes)
    let data = try JSONEncoder().encode(output)
    if let json = String(data: data, encoding: .utf8) {
      print(json)
    }
  } else {
    let text = results
      .compactMap { $0.topCandidates(1).first?.string }
      .joined(separator: "\n")
    print(text)
  }
} catch {
  writeError("Vision OCR failed: \(error.localizedDescription)")
  exit(1)
}

func languagePriority(_ language: String) -> Int {
  let normalized = language.lowercased()
  if normalized.hasPrefix("zh-") {
    return 0
  }
  if normalized.hasPrefix("en-") {
    return 1
  }
  return 2
}
