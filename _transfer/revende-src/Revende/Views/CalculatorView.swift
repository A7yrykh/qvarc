import SwiftUI

/// Быстрый расчёт маржи без создания товара (MarginPilot).
struct CalculatorView: View {
    @EnvironmentObject private var settings: SellerSettings

    @State private var platform: Platform = .vinted
    @State private var input = ProfitInput()
    @State private var targetProfit: Decimal = 10
    @State private var targetMargin: Decimal = 40
    @State private var didSetPlatform = false

    private var effectiveInput: ProfitInput {
        var copy = input
        copy.feeRule = settings.feeRule(for: platform)
        return copy
    }

    private var breakdown: ProfitBreakdown { ProfitCalculator.breakdown(effectiveInput) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Plataforma", selection: $platform) {
                        ForEach(Platform.allCases) { Text($0.displayName).tag($0) }
                    }
                    MoneyField("Precio de venta", value: $input.salePrice)
                    MoneyField("Precio de compra", value: $input.purchaseCost)
                    MoneyField("Otros gastos", value: $input.extraCosts)
                    MoneyField("Envío que pagas tú", value: $input.shippingBySeller)
                    MoneyField("Embalaje", value: $input.packaging)
                    MoneyField("Promoción", value: $input.promotion)
                } footer: {
                    let rule = settings.feeRule(for: platform)
                    if rule.isZero {
                        Text("\(platform.displayName): sin comisión para el vendedor particular. Cámbialo en Ajustes si eres Pro.")
                    } else {
                        Text("Comisión de \(platform.displayName): \(Money.percent(rule.percent)) + \(Money.format(rule.fixed)).")
                    }
                }

                if input.salePrice > 0 {
                    Section("Resultado") {
                        ProfitSummaryView(breakdown: breakdown)
                        if let buyerFee = platform.buyerProtectionFee(for: input.salePrice) {
                            LabeledContent("El comprador paga", value: Money.format(input.salePrice + buyerFee))
                        }
                    }
                    Section("Si te hacen una oferta") {
                        ForEach(ProfitCalculator.scenarios(listPrice: input.salePrice, effectiveInput)) { s in
                            HStack {
                                if s.discountPercent == 0 {
                                    Text("Precio completo")
                                } else {
                                    Text(verbatim: "−\(Money.percent(s.discountPercent))")
                                }
                                Spacer()
                                Text(Money.format(s.price)).foregroundStyle(.secondary)
                                Text(Money.format(s.netProfit))
                                    .monospacedDigit()
                                    .frame(minWidth: 80, alignment: .trailing)
                                    .foregroundStyle(s.netProfit >= 0 ? Color.green : Color.red)
                            }
                        }
                    }
                }

                Section {
                    if let breakEven = ProfitCalculator.minimumPrice(forProfit: 0, effectiveInput) {
                        LabeledContent("Para no perder", value: Money.format(breakEven))
                    }
                    MoneyField("Quiero ganar", value: $targetProfit)
                    if let price = ProfitCalculator.minimumPrice(forProfit: targetProfit, effectiveInput) {
                        LabeledContent("Pon el precio en", value: Money.format(price))
                    }
                    PercentField(title: "Quiero un margen de", value: $targetMargin)
                    if let price = ProfitCalculator.price(forMargin: targetMargin, effectiveInput) {
                        LabeledContent("Pon el precio en", value: Money.format(price))
                    } else {
                        Text("Ese margen no es posible con esta comisión.").foregroundStyle(.secondary)
                    }
                } header: {
                    Text("¿Qué precio pongo?")
                }
            }
            .navigationTitle("Calculadora")
            .scrollDismissesKeyboard(.interactively)
            .onAppear {
                if !didSetPlatform {
                    platform = settings.defaultPlatform
                    didSetPlatform = true
                    #if DEBUG
                    if DemoData.screen == "calculator" {
                        input = ProfitInput(salePrice: 45, purchaseCost: 15, extraCosts: 3,
                                            packaging: Decimal(string: "0.5")!, promotion: Decimal(string: "1.5")!)
                    }
                    #endif
                }
            }
        }
    }
}
