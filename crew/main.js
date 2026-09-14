// Funkcja odczytująca listę zapytań z localStorage i aktualizująca badge w menu
function updateCartBadge() {
    const cart = JSON.parse(localStorage.getItem('spokultura_cart')) || [];
    const badge = document.getElementById('cartCountBadge');
    
    if (badge) {
        const totalItems = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
        badge.textContent = totalItems;
        
        // Opcjonalnie: Ukryj badge jeśli koszyk jest pusty (0)
        badge.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }
}

// Inicjalizacja przy załadowaniu dowolnej podstrony
document.addEventListener('DOMContentLoaded', updateCartBadge);

// Synchronizacja w czasie rzeczywistym między otwartymi kartami
window.addEventListener('storage', (e) => {
    if (e.key === 'spokultura_cart') {
        updateCartBadge();
    }
});