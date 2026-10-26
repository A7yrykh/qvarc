import Foundation

/// Всё, что влияет на прибыль с одной вещи.
public struct ProfitInput: Equatable, Sendable {
    public var salePrice: Decimal
    public var purchaseCost: Decimal
    /// Чистка, ремонт, бирки — всё, что вложено в вещь до продажи.
    public var extraCosts: Decimal
    /// Доставка, если продавец предложил «envío gratis» или платит забор курьером.
    public var shippingBySeller: Decimal
    public var packaging: Decimal
    /// Продвижение объявления (bumps, destacados).
    public var promotion: Decimal
    public var feeRule: FeeRule

    public init(
        salePrice: Decimal = 0,
        purchaseCost: Decimal = 0,
        extraCosts: Decimal = 0,
        shippingBySeller: Decimal = 0,
        packaging: Decimal = 0,
        promotion: Decimal = 0,
        feeRule: FeeRule = .zero
    ) {
        self.salePrice = salePrice
        self.purchaseCost = purchaseCost
        self.extraCosts = extraCosts
        self.shippingBySeller = shippingBySeller
        self.packaging = packaging
        self.promotion = promotion
        self.feeRule = feeRule
    }

    /// Вложено в саму вещь.
    public var invested: Decimal { purchaseCost + extraCosts }
    /// Расходы на продажу без комиссии площадки.
    public var sellingCosts: Decimal { shippingBySeller + packaging + promotion }
}

public struct ProfitBreakdown: Equatable, Sendable {
    public var salePrice: Decimal
    public var platformFee: Decimal
    public var sellingCosts: Decimal
    public var invested: Decimal
    public var netProfit: Decimal
    /// Чистая прибыль к цене продажи, в процентах. nil, если цена 0.
    public var marginPercent: Decimal?
    /// Чистая прибыль к вложенному, в процентах. nil, если вещь досталась бесплатно.
    public var roiPercent: Decimal?

    /// Что продавец получит на счёт площадки (цена минус комиссия).
    public var payout: Decimal { salePrice - platformFee }
}

public struct PriceScenario: Equatable, Sendable, Identifiable {
    public var discountPercent: Decimal
    public var price: Decimal
    public var netProfit: Decimal
    public var id: Decimal { discountPercent }
}

public enum ProfitCalculator {
    public static func breakdown(_ input: ProfitInput) -> ProfitBreakdown {
        let fee = input.feeRule.fee(for: input.salePrice)
        let net = Money.round(input.salePrice - fee - input.sellingCosts - input.invested)
        let margin: Decimal? = input.salePrice > 0
            ? Money.round(net / input.salePrice * 100, scale: 1)
            : nil
        let roi: Decimal? = input.invested > 0
            ? Money.round(net / input.invested * 100, scale: 1)
            : nil
        return ProfitBreakdown(
            salePrice: input.salePrice,
            platformFee: fee,
            sellingCosts: input.sellingCosts,
            invested: input.invested,
            netProfit: net,
            marginPercent: margin,
            roiPercent: roi
        )
    }

    /// Минимальная цена, при которой чистая прибыль не меньше `targetProfit`.
    /// Цена продажи во входных данных игнорируется. nil, если комиссия ≥ 100 %.
    public static func minimumPrice(forProfit targetProfit: Decimal, _ input: ProfitInput) -> Decimal? {
        let rule = input.feeRule
        let rate = rule.percent / 100
        guard rate < 1 else { return nil }
        let costs = input.sellingCosts + input.invested + targetProfit
        // Прибыль = min(P·(1−r) − fixed, P − minimum) − costs, поэтому нужны оба условия.
        let byPercent = (costs + rule.fixed) / (1 - rate)
        let byMinimum = costs + rule.minimum
        let candidate = max(Money.roundUp(max(byPercent, byMinimum)), Money.cent)
        return settle(from: candidate, input) { $0.netProfit >= targetProfit }
    }

    /// Цена, при которой маржа (прибыль к цене) не меньше `marginPercent`.
    public static func price(forMargin marginPercent: Decimal, _ input: ProfitInput) -> Decimal? {
        let rule = input.feeRule
        let rate = rule.percent / 100
        let margin = marginPercent / 100
        guard rate + margin < 1, margin < 1 else { return nil }
        let costs = input.sellingCosts + input.invested
        let byPercent = (costs + rule.fixed) / (1 - rate - margin)
        let byMinimum = (costs + rule.minimum) / (1 - margin)
        let candidate = max(Money.roundUp(max(byPercent, byMinimum)), Money.cent)
        return settle(from: candidate, input) { b in
            b.salePrice > 0 && b.netProfit / b.salePrice * 100 >= marginPercent
        }
    }

    /// Прибыль при скидках от цены объявления — чтобы сразу видеть, какое предложение принимать.
    public static func scenarios(
        listPrice: Decimal,
        discounts: [Decimal] = [0, 5, 10, 15, 20],
        _ input: ProfitInput
    ) -> [PriceScenario] {
        discounts.map { discount in
            var copy = input
            copy.salePrice = Money.round(listPrice * (100 - discount) / 100)
            return PriceScenario(
                discountPercent: discount,
                price: copy.salePrice,
                netProfit: breakdown(copy).netProfit
            )
        }
    }

    /// Округление комиссии до центов может сдвинуть ответ на цент-другой: добираем перебором.
    private static func settle(
        from start: Decimal,
        _ input: ProfitInput,
        until satisfied: (ProfitBreakdown) -> Bool
    ) -> Decimal? {
        var price = start
        var copy = input
        for _ in 0..<500 {
            copy.salePrice = price
            if satisfied(breakdown(copy)) { return price }
            price += Money.cent
        }
        return nil
    }
}
