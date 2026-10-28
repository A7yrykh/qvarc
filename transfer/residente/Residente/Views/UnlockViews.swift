import StoreKit
import SwiftUI

/// Встроенная карточка на месте закрытой функции: показывает, что именно откроется.
struct UnlockCard: View {
    @Environment(\.lang) private var lang
    let reason: String
    let open: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                FlagBadge(size: 28)
                Text(W.full[lang]).font(.headline)
            }
            Text(reason).font(.subheadline).foregroundStyle(.secondary)
            Button(W.seeWhatsIncluded[lang], action: open)
                .buttonStyle(.bordered)
        }
        .padding(.vertical, 6)
    }
}

/// Покупка полной версии: тёмный «паспортный» лист в цветах иконки, без списка «Pro»-галочек.
struct UnlockSheet: View {
    @Environment(\.lang) private var lang
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var access: FullAccess
    let reason: String?

    var body: some View {
        ZStack {
            LinearGradient(colors: [.brandDeep, .brandNight], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark").font(.headline).foregroundStyle(Color.cream.opacity(0.8))
                                .frame(width: 36, height: 36).background(Color.white.opacity(0.12), in: Circle())
                        }
                        .accessibilityLabel(S.cancel[lang])
                    }
                    FlagBadge(size: 64)
                    Text(W.full[lang])
                        .font(.system(.largeTitle, design: .serif, weight: .bold))
                        .foregroundStyle(Color.cream)
                    Text(W.fullSubtitle[lang]).font(.headline).foregroundStyle(Color.flagYellow)
                    if let reason {
                        Text(reason).font(.subheadline).foregroundStyle(Color.cream.opacity(0.85))
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(W.fullFeatures.indices, id: \.self) { i in
                            let f = W.fullFeatures[i]
                            HStack(spacing: 14) {
                                Image(systemName: f.symbol)
                                    .font(.headline)
                                    .foregroundStyle(Color.brandNight)
                                    .frame(width: 34, height: 34)
                                    .background(Color.cream, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                Text(f.text[lang]).foregroundStyle(Color.cream)
                            }
                        }
                    }
                    .padding(.vertical, 8)

                    if access.isUnlocked {
                        Label(W.fullActive[lang], systemImage: "checkmark.seal.fill")
                            .font(.headline).foregroundStyle(Color.flagYellow)
                    } else if let product = access.product {
                        Button {
                            Task {
                                await access.purchase()
                                if access.isUnlocked { dismiss() }
                            }
                        } label: {
                            Text(S.buy.format(lang, product.displayPrice))
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .foregroundStyle(Color.brandNight)
                                .background(Color.flagYellow, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                    } else if access.isLoading {
                        ProgressView().tint(Color.cream)
                    } else {
                        Text(S.storeUnavailable[lang]).foregroundStyle(Color.cream.opacity(0.8))
                    }

                    if let error = access.errorMessage {
                        Text(error).font(.footnote).foregroundStyle(Color.flagYellow)
                    }

                    HStack(spacing: 16) {
                        Button(S.restore[lang]) { Task { await access.restore() } }
                        Link("Privacy Policy", destination: AppInfo.privacyURL)
                        Link("Terms of Use (EULA)", destination: AppInfo.termsURL)
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.cream.opacity(0.75))
                    .padding(.top, 8)
                }
                .padding(24)
            }
        }
        .task { if access.product == nil { await access.loadProduct() } }
    }
}
