import SwiftUI

/// Отметка продажи: площадка, цена, дата, расходы. Комиссия считается по настройкам.
struct SoldSheet: View {
    @Bindable var item: Item
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var settings: SellerSettings

    @State private var platform: Platform = .vinted
    @State private var price: Decimal = 0
    @State private var date: Date = .now
    @State private var shipping: Decimal = 0
    @State private var packaging: Decimal = 0
    @State private var promotion: Decimal = 0
    @State private var fee: Decimal = 0
    /// Значения при открытии: onChange срабатывает и на загрузку, а сохранённую комиссию затирать нельзя.
    @State private var initial: (platform: Platform, price: Decimal)?

    private var input: ProfitInput {
        ProfitInput(
            salePrice: price, purchaseCost: item.purchaseCost, extraCosts: item.extraCosts,
            shippingBySeller: shipping, packaging: packaging, promotion: promotion,
            feeRule: FeeRule(fixed: fee)
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Plataforma", selection: $platform) {
                        ForEach(Platform.allCases) { Text($0.displayName).tag($0) }
                    }
                    MoneyField("Precio de venta", value: $price)
                    DatePicker("Fecha", selection: $date, displayedComponents: .date)
                }
                Section {
                    MoneyField("Comisión de la plataforma", value: $fee)
                    MoneyField("Envío que pagas tú", value: $shipping)
                    MoneyField("Embalaje", value: $packaging)
                    MoneyField("Promoción", value: $promotion)
                } footer: {
                    Text("La comisión se calcula con tus ajustes de \(platform.displayName). En Vinted y Wallapop los particulares no pagan comisión: la protección la paga el comprador.")
                }
                if price > 0 {
                    Section {
                        ProfitSummaryView(breakdown: ProfitCalculator.breakdown(input))
                    }
                }
            }
            .navigationTitle("Venta")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", action: save).disabled(price <= 0)
                }
            }
            .onAppear(perform: load)
            .onChange(of: platform) { recalculateFee() }
            .onChange(of: price) { recalculateFee() }
        }
    }

    private func load() {
        if item.status == .sold {
            platform = item.soldPlatform ?? settings.defaultPlatform
            price = item.salePrice
            date = item.soldAt ?? .now
            fee = item.platformFee
        } else {
            platform = item.listedPlatforms.first ?? settings.defaultPlatform
            price = item.listPrice
            fee = settings.feeRule(for: platform).fee(for: price)
        }
        shipping = item.shippingBySeller
        packaging = item.packaging
        promotion = item.promotion
        initial = (platform, price)
    }

    private func recalculateFee() {
        guard let initial, initial.platform != platform || initial.price != price else { return }
        fee = settings.feeRule(for: platform).fee(for: price)
    }

    private func save() {
        item.soldPlatform = platform
        item.salePrice = price
        item.soldAt = date
        item.platformFee = fee
        item.shippingBySeller = shipping
        item.packaging = packaging
        item.promotion = promotion
        item.status = .sold
        dismiss()
    }
}
