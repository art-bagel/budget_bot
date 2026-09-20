import SwiftUI

@main
struct BudgetApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    @StateObject private var model = WebViewModel()

    var body: some View {
        ZStack {
            WebView(webView: model.webView)

            if let failure = model.failure {
                FailureView(message: failure, retry: model.load)
            }
        }
        .ignoresSafeArea()
        .onAppear(perform: model.load)
    }
}

private struct FailureView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("Приложение недоступно")
                .font(.headline)

            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Повторить", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
