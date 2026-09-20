import Foundation

/// Единственное место, где задан адрес приложения.
///
/// Сюда прописывается тот же URL, который открывается в браузере. Схема
/// обязана быть https: App Transport Security блокирует http, и ослаблять
/// её ради удобства не нужно — прод и так под TLS.
enum Config {
    static let appURLString = "https://budget.mrbagel.ru"

    /// nil, пока адрес не подставлен — тогда приложение покажет понятный
    /// экран вместо падения на старте.
    static var appURL: URL? {
        guard appURLString.hasPrefix("https://"), !appURLString.contains("REPLACE-ME") else {
            return nil
        }
        return URL(string: appURLString)
    }
}
