import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: SellerSettings
    @EnvironmentObject private var subscription: SubscriptionService
    @State private var showPaywall = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if subscription.isPro {
                        Label("Revende Pro activo", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                    } else {
                        Button("Hazte Pro", systemImage: "star.fill") { showPaywall = true }
                    }
                    Button("Restaurar compras") { Task { await subscription.restore() } }
                    #if DEBUG
                    Toggle("Simular Pro (solo pruebas)", isOn: $subscription.debugForcePro)
                    #endif
                }

                Section {
                    Picker("Plataforma habitual", selection: $settings.defaultPlatform) {
                        ForEach(Platform.allCases) { Text($0.displayName).tag($0) }
                    }
                    MoneyField("Embalaje por defecto", value: $settings.defaultPackaging)
                } header: {
                    Text("Por defecto")
                }

                Section {
                    ForEach(Platform.allCases) { platform in
                        NavigationLink {
                            FeeRuleEditor(platform: platform)
                        } label: {
                            LabeledContent(platform.displayName, value: describe(settings.feeRule(for: platform)))
                        }
                    }
                } header: {
                    Text("Comisiones del vendedor")
                } footer: {
                    Text("Como particular, en Vinted y Wallapop no pagas comisión: la protección al comprador la paga quien compra. Ajusta aquí si vendes como profesional o en eBay.")
                }

                Section("Sobre Revende") {
                    Link("Soporte", destination: AppLinks.support)
                    Link("Política de privacidad", destination: AppLinks.privacy)
                    Link("Condiciones de uso", destination: AppLinks.terms)
                    LabeledContent("Versión", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                    Text("Las fotos y los textos se procesan en tu iPhone; no se envían a ningún servidor. Revende no está afiliada a Vinted, Wallapop, eBay ni Milanuncios.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Ajustes")
            .sheet(isPresented: $showPaywall) { PaywallView() }
        }
    }

    private func describe(_ rule: FeeRule) -> String {
        if rule.isZero { return String(localized: "Sin comisión") }
        var parts: [String] = []
        if rule.percent != 0 { parts.append(Money.percent(rule.percent)) }
        if rule.fixed != 0 { parts.append(Money.format(rule.fixed)) }
        if rule.minimum != 0 { parts.append(String(localized: "mín. \(Money.format(rule.minimum))")) }
        return parts.joined(separator: " + ")
    }
}

private struct FeeRuleEditor: View {
    let platform: Platform
    @EnvironmentObject private var settings: SellerSettings
    @State private var rule = FeeRule.zero

    var body: some View {
        Form {
            Section {
                PercentField(title: "Porcentaje", value: $rule.percent)
                MoneyField("Fijo por venta", value: $rule.fixed)
                MoneyField("Mínimo por venta", value: $rule.minimum)
            } footer: {
                Text("Ejemplo: 100 € de venta → comisión \(Money.format(rule.fee(for: 100))).")
            }
            Section {
                Button("Restablecer", role: .destructive) {
                    rule = platform.defaultSellerFee
                }
            }
        }
        .navigationTitle(platform.displayName)
        .onAppear { rule = settings.feeRule(for: platform) }
        .onDisappear { settings.setFeeRule(rule, for: platform) }
    }
}
