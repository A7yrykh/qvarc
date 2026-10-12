import Foundation

/// Ошибка, понятная гостю. Текст берём из ответа сервера, он уже на русском.
struct APIError: LocalizedError, Equatable {
    let status: Int
    let code: String
    let message: String

    var errorDescription: String? { message }

    static let network = APIError(status: 0, code: "network", message: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.")
    static let sessionExpired = APIError(status: 401, code: "unauthorized", message: "Сессия закончилась. Войдите снова.")
}

/// Пустой ответ (204 или тело, которое нам не нужно)
struct Ignored: Decodable {}

/// Запрос без тела
struct NoBody: Encodable {}

private struct ErrorBody: Decodable {
    struct Inner: Decodable {
        let code: String
        let message: String
        let details: [Detail]?
    }
    struct Detail: Decodable {
        let path: String?
        let message: String?
    }
    let error: Inner
}

/// HTTP-клиент к backend QVARC: токен в заголовке, одно автоматическое обновление токена при 401.
@MainActor
final class APIClient {
    let baseURL: URL
    private let session: URLSession
    private var accessToken: String?
    private(set) var refreshToken: String?
    private var refreshTask: Task<RefreshResult, Never>?

    private enum RefreshResult { case ok, rejected, failed }

    /// Вызывается, когда обновить токен не удалось — приложение показывает экран входа.
    var onSessionExpired: (() -> Void)?

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            if let date = ISODate.parse(s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Неизвестный формат даты: \(s)")
        }
        return d
    }()

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(ISODate.string(date))
        }
        return e
    }()

    init(baseURL: URL) {
        self.baseURL = baseURL
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 20
        cfg.waitsForConnectivity = false
        self.session = URLSession(configuration: cfg)
        self.refreshToken = Keychain.read(Keychain.refreshTokenKey)
    }

    var hasSession: Bool { refreshToken != nil }

    func setTokens(_ t: AuthTokens) {
        accessToken = t.accessToken
        refreshToken = t.refreshToken
        Keychain.save(t.refreshToken, for: Keychain.refreshTokenKey)
    }

    func clearTokens() {
        accessToken = nil
        refreshToken = nil
        Keychain.delete(Keychain.refreshTokenKey)
    }

    // MARK: - Запросы

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try await send("GET", path, query: query, body: nil as NoBody?, idempotencyKey: nil)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, _ body: B, idempotencyKey: String? = nil, auth: Bool = true) async throws -> T {
        try await send("POST", path, body: body, idempotencyKey: idempotencyKey, auth: auth)
    }

    func put<T: Decodable, B: Encodable>(_ path: String, _ body: B) async throws -> T {
        try await send("PUT", path, body: body, idempotencyKey: nil)
    }

    private func send<T: Decodable, B: Encodable>(
        _ method: String, _ path: String, query: [String: String] = [:], body: B?, idempotencyKey: String?, auth: Bool = true
    ) async throws -> T {
        let bodyData: Data? = try body.map { try Self.encoder.encode($0) }
        var (data, status) = try await perform(method, path, query: query, body: bodyData, idempotencyKey: idempotencyKey, auth: auth)

        if status == 401 && auth {
            // Токен доступа живёт 15 минут — пробуем обновить один раз и повторить.
            switch await refresh() {
            case .ok:
                (data, status) = try await perform(method, path, query: query, body: bodyData, idempotencyKey: idempotencyKey, auth: auth)
            case .rejected:
                clearTokens()
                onSessionExpired?()
                throw APIError.sessionExpired
            case .failed:
                // Нет связи — не выкидываем гостя из приложения
                throw APIError.network
            }
        }

        guard (200..<300).contains(status) else { throw Self.parseError(data, status: status) }
        if T.self == Ignored.self { return Ignored() as! T }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            #if DEBUG
            print("Не удалось разобрать ответ \(method) \(path): \(error)")
            #endif
            throw APIError(status: status, code: "decode", message: "Сервер ответил в неожиданном формате. Обновите приложение.")
        }
    }

    private func perform(_ method: String, _ path: String, query: [String: String], body: Data?, idempotencyKey: String?, auth: Bool) async throws -> (Data, Int) {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let idempotencyKey { req.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        if auth {
            if accessToken == nil, refreshToken != nil { _ = await refresh() }
            if let accessToken { req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization") }
        }
        do {
            let (data, resp) = try await session.data(for: req)
            return (data, (resp as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw APIError.network
        }
    }

    /// Обновление токена. Параллельные запросы ждут одно и то же обновление.
    private func refresh() async -> RefreshResult {
        if let refreshTask { return await refreshTask.value }
        guard let token = refreshToken else { return .rejected }
        let task = Task<RefreshResult, Never> { [weak self] in
            guard let self else { return .failed }
            struct Body: Encodable { let refreshToken: String }
            do {
                let body = try Self.encoder.encode(Body(refreshToken: token))
                let (data, status) = try await self.perform("POST", "auth/refresh", query: [:], body: body, idempotencyKey: nil, auth: false)
                if status == 400 || status == 401 { return .rejected }
                guard status == 200 else { return .failed }
                let t = try Self.decoder.decode(AuthTokens.self, from: data)
                self.setTokens(t)
                return .ok
            } catch {
                return .failed
            }
        }
        refreshTask = task
        let ok = await task.value
        refreshTask = nil
        return ok
    }

    private static func parseError(_ data: Data, status: Int) -> APIError {
        if let e = try? decoder.decode(ErrorBody.self, from: data) {
            // Для ошибок проверки показываем первую конкретную причину
            if let detail = e.error.details?.first?.message, e.error.code == "validation_error" {
                return APIError(status: status, code: e.error.code, message: "\(e.error.message): \(detail)")
            }
            return APIError(status: status, code: e.error.code, message: e.error.message)
        }
        if status >= 500 { return APIError(status: status, code: "server", message: "На сервере ошибка. Попробуйте позже или позвоните администратору.") }
        return APIError(status: status, code: "http_\(status)", message: "Не получилось выполнить запрос (код \(status)).")
    }
}
