import StoreKit
import SwiftUI

struct PaywallView: View {
    @EnvironmentObject private var purchases: PurchaseManager
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var choice = PurchaseManager.yearlyID

    private var selected: Product? { purchases.products.first { $0.id == choice } }
    private var showsTrial: Bool {
        choice == PurchaseManager.yearlyID && purchases.trialEligible
            && purchases.yearly?.subscription?.introductoryOffer != nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    Image(systemName: "crown.fill")
                        .font(.system(size: 52))
                        .foregroundStyle(.yellow.gradient)
                        .padding(.top, 8)
                    Text("Despeja Pro").font(.largeTitle.bold())
                    VStack(alignment: .leading, spacing: 12) {
                        Benefit(text: "Borra sin límite diario duplicados, ráfagas, capturas y vídeos")
                        Benefit(text: "Libera gigas en minutos, sin revisar foto a foto")
                        Benefit(text: "Todo sigue en tu iPhone: sin cuentas, sin anuncios")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if purchases.products.isEmpty {
                        ProgressView().padding()
                    } else {
                        VStack(spacing: 10) {
                            if let yearly = purchases.yearly {
                                PlanRow(product: yearly, isSelected: choice == yearly.id,
                                        title: "Anual", price: "\(yearly.displayPrice) al año",
                                        note: purchases.trialEligible ? "3 días gratis" : nil,
                                        detail: "Equivale a \(weekly(of: yearly)) a la semana") { choice = yearly.id }
                            }
                            if let weekly = purchases.weekly {
                                PlanRow(product: weekly, isSelected: choice == weekly.id,
                                        title: "Semanal", price: "\(weekly.displayPrice) a la semana",
                                        note: nil, detail: nil) { choice = weekly.id }
                            }
                        }
                    }

                    Button {
                        if let selected { Task { await purchases.purchase(selected); if purchases.isPro { dismiss() } } }
                    } label: {
                        Group {
                            if purchases.isPurchasing {
                                ProgressView().tint(.white)
                            } else if showsTrial {
                                Text("Probar 3 días gratis")
                            } else {
                                Text("Continuar")
                            }
                        }
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.roundedRectangle(radius: 14))
                    .disabled(selected == nil || purchases.isPurchasing)

                    if let selected {
                        Group {
                            if showsTrial {
                                Text("3 días gratis, después \(selected.displayPrice) al año. Cancela cuando quieras.")
                            } else if selected.id == PurchaseManager.yearlyID {
                                Text("\(selected.displayPrice) al año. Cancela cuando quieras.")
                            } else {
                                Text("\(selected.displayPrice) a la semana. Cancela cuando quieras.")
                            }
                        }
                        .font(.footnote.weight(.semibold))
                        .multilineTextAlignment(.center)
                    }

                    Text("El pago se carga a tu Apple ID al confirmar la compra. La suscripción se renueva automáticamente salvo que la canceles al menos 24 horas antes de que termine el periodo. Puedes gestionarla o cancelarla en Ajustes > Apple ID > Suscripciones. Sin Pro puedes analizar la galería y borrar 20 archivos al día gratis.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    HStack(spacing: 18) {
                        Button("Restaurar compras") { Task { await purchases.restore(); if purchases.isPro { dismiss() } } }
                        Button("Privacidad") { openURL(AppInfo.privacyURL) }
                        Button("Términos (EULA)") { openURL(AppInfo.termsURL) }
                    }
                    .font(.caption)
                }
                .padding(24)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel(Text("Cerrar"))
                }
            }
            .alert("Despeja Pro", isPresented: Binding(get: { purchases.message != nil },
                                                       set: { if !$0 { purchases.message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(purchases.message ?? "")
            }
            .task { await purchases.load() }
        }
    }

    private func weekly(of yearly: Product) -> String {
        (yearly.price / 52).formatted(yearly.priceFormatStyle)
    }

    private struct Benefit: View {
        let text: LocalizedStringKey

        var body: some View {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.brand)
                Text(text).font(.callout)
            }
        }
    }

    private struct PlanRow: View {
        let product: Product
        let isSelected: Bool
        let title: LocalizedStringKey
        let price: LocalizedStringKey
        let note: LocalizedStringKey?
        let detail: LocalizedStringKey?
        let action: () -> Void

        var body: some View {
            Button(action: action) {
                HStack(spacing: 12) {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.title2)
                        .foregroundStyle(isSelected ? Color.brand : Color.secondary)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            Text(title).font(.headline)
                            if let note {
                                Text(note)
                                    .font(.caption2.weight(.bold))
                                    .padding(.horizontal, 7).padding(.vertical, 3)
                                    .background(Color.brand, in: Capsule())
                                    .foregroundStyle(.white)
                            }
                        }
                        Text(price).font(.subheadline)
                        if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                }
                .padding(14)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(isSelected ? Color.brand : Color.secondary.opacity(0.25), lineWidth: 2)
                }
            }
            .buttonStyle(.plain)
        }
    }
}
