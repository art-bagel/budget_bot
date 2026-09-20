import SwiftUI
import WebKit

/// WKWebView, живущий дольше SwiftUI-вью, чтобы перерисовка не перезагружала
/// страницу и не теряла состояние приложения.
@MainActor
final class WebViewModel: NSObject, ObservableObject, WKNavigationDelegate {
    /// Текст ошибки загрузки; nil — страница открыта.
    @Published private(set) var failure: String?

    let webView: WKWebView

    override init() {
        // Хранилище по умолчанию персистентное — localStorage с сессионным
        // токеном переживает перезапуск приложения, повторный вход не нужен.
        webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        super.init()

        webView.navigationDelegate = self
        // Отступы под чёлку и home indicator рисует сам веб-фронт через
        // env(safe-area-inset-*), поэтому нативные вставки выключены.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        webView.isInspectable = true
        #endif
    }

    func load() {
        guard let url = Config.appURL else {
            failure = "Не задан адрес приложения — впишите его в ios/Budget/Config.swift"
            return
        }

        failure = nil
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        failure = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failure = error.localizedDescription
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        // Сюда попадают обрывы сети и недоступный сервер — самый частый
        // случай, ради которого экран ошибки вообще существует.
        failure = error.localizedDescription
    }
}

struct WebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
