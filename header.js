document.addEventListener("DOMContentLoaded", function () {
    // Pobranie i czyszczenie ścieżki (usuwamy parametry ? oraz końcowe slashe)
    const rawPath = window.location.pathname.toLowerCase().split('?')[0];
    const path = rawPath.endsWith('/') && rawPath.length > 1 ? rawPath.slice(0, -1) : rawPath;

    // Funkcja precyzyjnie określająca aktywną zakładkę
    const isActive = (targetSegment) => {
        if (targetSegment === '/') {
            return (path === '' || path === '/' || path.endsWith('/index.html')) ? 'active' : '';
        }
        
        // Rozbijamy ścieżkę na segmenty, np. "/media/artykiul-1" -> ["media", "artykiul-1"]
        const segments = path.split('/').filter(Boolean);
        const cleanTarget = targetSegment.replace(/\//g, '');
        
        // Sprawdzamy czy główny segment adresu zgadza się z docelowym
        return segments[0] === cleanTarget ? 'active' : '';
    };

    const headerHTML = `
        <header class="site-header glassmorphism animate-entry delay-1" id="top">
            <a href="/" class="brand-logo" title="SPOKULTURA — Strona Główna">
                <img src="/assets/logo.png" alt="Spokultura Logo">
            </a>
            <nav class="main-navigation">
                <a href="/" class="${isActive('/')}">START</a>
                <a href="/media" class="${isActive('media')}">ARTYKUŁY</a>
                <a href="/odziez" class="${isActive('odziez')}">ODZIEŻ & MERCH</a>
                <a href="/looper" class="${isActive('looper')}">LOOPER</a>
                <a href="/crew" class="${isActive('crew')}">EKIPA - O NAS</a>
                <a href="/odziez#faq">JAK TO DZIAŁA / FAQ</a>
                <a href="https://facebook.com" target="_blank" rel="noopener">FB</a>
                <a href="https://instagram.com" target="_blank" rel="noopener">IG</a>
            </nav>
            <button class="cart-trigger-btn" id="openCartBtn" aria-label="Otwórz listę zapytań">
                <span>LISTA ZAPYTAŃ</span>
                <span class="cart-count-badge" id="cartCount">0</span>
            </button>
        </header>
    `;

    const container = document.getElementById("site-header-container");
    if (container) {
        container.innerHTML = headerHTML;
    }

    const cartCountEl = document.getElementById("cartCount");
    if (cartCountEl) {
        try {
            const cart = JSON.parse(localStorage.getItem("spokultura_inquiry_cart")) || [];
            const totalCount = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
            cartCountEl.textContent = totalCount;
        } catch (e) {
            cartCountEl.textContent = "0";
        }
    }

    const openCartBtn = document.getElementById("openCartBtn");
    if (openCartBtn && !path.includes("/odziez")) {
        openCartBtn.addEventListener("click", function () {
            window.location.href = "/odziez";
        });
    }
});