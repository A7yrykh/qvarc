import SwiftUI
import UIKit

/// Поле суммы в евро: принимает «12,50» и «12.5».
struct MoneyField: View {
    let title: LocalizedStringKey
    @Binding var value: Decimal
    @State private var text = ""
    @FocusState private var focused: Bool

    init(_ title: LocalizedStringKey, value: Binding<Decimal>) {
        self.title = title
        _value = value
    }

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            TextField("0,00", text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 110)
                .focused($focused)
            Text("€").foregroundStyle(.secondary)
        }
        .onAppear { text = Self.text(for: value) }
        .onChange(of: text) { _, newValue in
            value = Money.parse(newValue) ?? 0
        }
        .onChange(of: value) { _, newValue in
            if !focused { text = Self.text(for: newValue) }
        }
    }

    private static func text(for value: Decimal) -> String {
        value == 0 ? "" : Money.plain(value)
    }
}

/// Поле процента для комиссий.
struct PercentField: View {
    let title: LocalizedStringKey
    @Binding var value: Decimal
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            TextField("0", text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 80)
                .focused($focused)
            Text("%").foregroundStyle(.secondary)
        }
        .onAppear { text = Self.text(for: value) }
        .onChange(of: text) { _, newValue in value = Money.parse(newValue) ?? 0 }
        .onChange(of: value) { _, newValue in
            if !focused { text = Self.text(for: newValue) }
        }
    }

    private static func text(for value: Decimal) -> String {
        value == 0 ? "" : "\(value)".replacingOccurrences(of: ".", with: ",")
    }
}

/// Итог по прибыли: крупно чистая прибыль, ниже разбивка.
struct ProfitSummaryView: View {
    let breakdown: ProfitBreakdown
    var title: LocalizedStringKey = "Beneficio neto"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                Text(Money.format(breakdown.netProfit))
                    .font(.title2.bold())
                    .foregroundStyle(breakdown.netProfit >= 0 ? Color.green : Color.red)
            }
            HStack(spacing: 16) {
                if let margin = breakdown.marginPercent {
                    Metric(label: "Margen", value: Money.percent(margin))
                }
                if let roi = breakdown.roiPercent {
                    Metric(label: "ROI", value: Money.percent(roi))
                }
                Metric(label: "Comisión", value: Money.format(breakdown.platformFee))
                Metric(label: "Cobras", value: Money.format(breakdown.payout))
            }
        }
        .padding(.vertical, 4)
    }

    private struct Metric: View {
        let label: LocalizedStringKey
        let value: String

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption2).foregroundStyle(.secondary)
                Text(value).font(.footnote.monospacedDigit())
            }
        }
    }
}

struct StatTile: View {
    let title: LocalizedStringKey
    let value: String
    var footnote: String?
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.bold().monospacedDigit()).foregroundStyle(tint)
                .lineLimit(1).minimumScaleFactor(0.6)
            if let footnote {
                Text(footnote).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct PhotoThumb: View {
    let data: Data?
    var size: CGFloat = 56

    var body: some View {
        Group {
            if let data, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "photo").font(.title3).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.tertiarySystemFill))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

/// Камера через UIImagePickerController (PhotosPicker камеру не открывает).
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

/// Копирует текст и коротко подтверждает.
struct CopyButton: View {
    let label: LocalizedStringKey
    let text: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        } label: {
            if copied {
                Label("Copiado", systemImage: "checkmark")
            } else {
                Label(label, systemImage: "doc.on.doc")
            }
        }
        .disabled(text.isEmpty)
    }
}
