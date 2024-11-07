import Foundation

class ElectricShape: ObservableObject {
    @Published var data: [String: Any] = [:]
    private var offset: String = "-1"
    private var handle: String?
    private var cursor: String?
    private var live: Bool = false
    private let baseUrl: String
    private let table: String
    private let whereClause: String?
    private var messages: [[[String: Any]]] = []
    private var subscribers: [(Data) -> Void] = []

    init(baseUrl: String = "http://localhost:3000", table: String, whereClause: String? = nil) {
        self.baseUrl = baseUrl
        self.table = table
        self.whereClause = whereClause
    }

    func subscribe(callback: @escaping (Data) -> Void) {
        subscribers.append(callback)
    }

    func sync() {
        Task {
            while true {
                await request()
            }
        }
    }

    private func request() async {
        guard let url = buildUrl() else {
            print("Error building URL")
            return
        }

        do {
            var request = URLRequest(url: url)
            request.httpMethod = "GET"

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                print("Invalid response")
                return
            }

            if httpResponse.statusCode > 204 {
                print("Error: \(httpResponse.statusCode)")
                return
            }

            if httpResponse.statusCode == 200 {
                if let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]] {
                    messages.append(json)
                } else {
                    print("Failed to decode JSON")
                    return
                }

                if httpResponse.allHeaderFields["electric-up-to-date"] != nil {
                    live = true
                    processMessages()
                }
            }

            handle = httpResponse.allHeaderFields["electric-handle"] as? String
            offset = httpResponse.allHeaderFields["electric-offset"] as? String
            cursor = httpResponse.allHeaderFields["electric-cursor"] as? String

        } catch {
            print("Error fetching data: \(error)")
        }
    }

    private func processMessages() {
        var hasChanged = false

        for batch in messages {
            for message in batch {
                if let opChanged = applyOperation(message), opChanged {
                    hasChanged = true
                }
            }
        }

        messages = []

        if hasChanged {
            notifySubscribers()
        }
    }

    private func applyOperation(_ message: [String: Any]) -> Bool? {
        guard let headers = message["headers"] as? [String: String],
              let operation = headers["operation"],
              let key = message["key"] as? String else { return nil }

        let cleanKey = key.replacingOccurrences(of: "\"", with: "").split(separator: "/").last!
        let value = message["value"] as? [String: Any]

        switch operation {
        case "insert":
            data[String(cleanKey)] = value
            return true
        case "update":
            guard var currentValue = data[String(cleanKey)] as? [String: Any] else { return false }
            var hasChanged = false

            if let value = value {
                for (k, v) in value {
                    if currentValue[k] != v {
                        hasChanged = true
                        currentValue[k] = v
                    }
                }
            }

            data[String(cleanKey)] = currentValue
            return hasChanged
        case "delete":
            if data.keys.contains(String(cleanKey)) {
                data.removeValue(forKey: String(cleanKey))
                return true
            }
            return false
        default:
            return nil
        }
    }

    private func notifySubscribers() {
        for callback in subscribers {
            callback(try! JSONSerialization.data(withJSONObject: data, options: .prettyPrinted))
        }
    }

    private func buildUrl() -> URL? {
        var components = URLComponents(string: "\(baseUrl)/v1/shape")
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "table", value: table),
            URLQueryItem(name: "offset", value: offset)
        ]

        if let cursor = cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }

        if let handle = handle {
            queryItems.append(URLQueryItem(name: "handle", value: handle))
        }

        if live {
            queryItems.append(URLQueryItem(name: "live", value: "true"))
        }

        if let whereClause = whereClause {
            queryItems.append(URLQueryItem(name: "where", value: whereClause))
        }

        components?.queryItems = queryItems
        return components?.url
    }
}