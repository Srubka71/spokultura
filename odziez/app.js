/**
 * SPOKULTURA — ODZIEŻ & MERCH
 * Aplikacja (app.js) - Slider kafelków (Przód/Tył + Galerie) + Lightbox w modalu
 */

document.addEventListener("DOMContentLoaded", () => {
    let cart = JSON.parse(localStorage.getItem("spokultura_inquiry_cart")) || [];
    let currentSelectedProduct = null;
    let selectedSize = null;
    let selectedColor = null;

    const productModal = document.getElementById("productModal");
    const closeProductModal = document.getElementById("closeProductModal");
    const productModalContent = document.getElementById("productModalContent");

    const cartModal = document.getElementById("cartModal");
    const closeCartModal = document.getElementById("closeCartModal");
    const openCartBtn = document.getElementById("openCartBtn");
    const heroCartBtn = document.getElementById("heroCartBtn");
    const barCartBtn = document.getElementById("barCartBtn");
    const cartItemsList = document.getElementById("cartItemsList");
    const cartTotalQuantity = document.getElementById("cartTotalQuantity");
    const cartTotalPrice = document.getElementById("cartTotalPrice");
    const continueShoppingBtn = document.getElementById("continueShoppingBtn");
    const proceedToInquiryBtn = document.getElementById("proceedToInquiryBtn");

    const inquiryModal = document.getElementById("inquiryModal");
    const closeInquiryModal = document.getElementById("closeInquiryModal");
    const backToCartBtn = document.getElementById("backToCartBtn");
    const inquiryForm = document.getElementById("inquiryForm");
    const inquiryItemsSummary = document.getElementById("inquiryItemsSummary");
    const formCartDataHidden = document.getElementById("formCartDataHidden");
    const formTotalHidden = document.getElementById("formTotalHidden");
    const submitInquiryBtn = document.getElementById("submitInquiryBtn");

    const cartCountBadge = document.getElementById("cartCount");
    const heroCartCount = document.querySelector(".hero-cart-count");
    const barCartCount = document.querySelector(".bar-cart-count");

    if (typeof CONFIG !== 'undefined' && CONFIG.formspreeId && inquiryForm) {
        inquiryForm.action = `https://formspree.io/f/${CONFIG.formspreeId}`;
    }

    /* ==========================================================================
       POMOCNIK: AGREGACJA WSZYSTKICH ZDJĘĆ PRODUKTU (images + image + backImage)
       ========================================================================== */
    function getProductImages(product) {
        if (product.images && product.images.length > 0) {
            return product.images;
        }
        
        const list = [];
        if (product.image) list.push(product.image);
        if (product.backImage) list.push(product.backImage);
        
        return list.length > 0 ? list : ["assets/background.jpg"];
    }

    /* ==========================================================================
       1. RENDEROWANIE SIATKI PRODUKTÓW ZE SLIDEREM (PRZÓD / TYŁ / GALERIE)
       ========================================================================== */
    function renderProductsGrid() {
        const grid = document.getElementById("productsGrid");
        if (!grid || typeof CONFIG === 'undefined' || !CONFIG.products) return;

        grid.innerHTML = CONFIG.products.map(product => {
            const imageList = getProductImages(product);
            const hasMultipleImages = imageList.length > 1;

            return `
                <div class="product-card" data-id="${product.id}">
                    <div class="product-image-box" data-id="${product.id}">
                        <span class="product-category-tag">${product.category}</span>
                        
                        <div class="card-slider-wrapper">
                            ${imageList.map((imgSrc, idx) => `
                                <img src="${imgSrc}" class="card-slider-img ${idx === 0 ? 'active' : ''}" alt="${product.name}" onerror="this.onerror=null; this.src='assets/background.jpg';">
                            `).join('')}
                        </div>

                        ${hasMultipleImages ? `
                            <button class="slider-arrow prev-arrow" aria-label="Poprzednie zdjęcie">&lsaquo;</button>
                            <button class="slider-arrow next-arrow" aria-label="Następne zdjęcie">&rsaquo;</button>
                        ` : ''}
                    </div>
                    <div class="product-info">
                        <div>
                            <h3 class="product-title">${product.name}</h3>
                            <p class="product-desc">${product.description}</p>
                        </div>
                        <div class="product-bottom">
                            <span class="product-price">~${product.price} PLN</span>
                            <button class="btn btn-small btn-primary open-product-btn" data-id="${product.id}">
                                SPRAWDŹ / ZAPYTAJ
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        // Obsługa kliknięcia "Sprawdź / Zapytaj"
        document.querySelectorAll(".open-product-btn").forEach(el => {
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                const id = el.getAttribute("data-id");
                if (id) openProductModalHandler(id);
            });
        });

        // Obsługa kliknięcia w cały kafelek (otwieranie modalu)
        document.querySelectorAll(".product-card").forEach(card => {
            card.addEventListener("click", (e) => {
                // Zapobieganie otwarciu modalu przy klikaniu w strzałki slidera
                if (e.target.classList.contains("slider-arrow")) return;
                const id = card.getAttribute("data-id");
                if (id) openProductModalHandler(id);
            });
        });

        // Obsługa automatycznych sliderów i przełączania zdjęć na kafelkach
        document.querySelectorAll(".product-image-box").forEach(box => {
            const images = box.querySelectorAll(".card-slider-img");
            const prevBtn = box.querySelector(".prev-arrow");
            const nextBtn = box.querySelector(".next-arrow");
            
            if (images.length <= 1) return;

            let currentIndex = 0;
            let interval = null;

            const showImage = (index) => {
                images.forEach((img, i) => {
                    img.classList.toggle("active", i === index);
                });
            };

            const nextImage = () => {
                currentIndex = (currentIndex + 1) % images.length;
                showImage(currentIndex);
            };

            const prevImage = () => {
                currentIndex = (currentIndex - 1 + images.length) % images.length;
                showImage(currentIndex);
            };

            const startAutoplay = () => {
                if (!interval) interval = setInterval(nextImage, 2500);
            };

            const stopAutoplay = () => {
                if (interval) {
                    clearInterval(interval);
                    interval = null;
                }
            };

            startAutoplay();

            box.addEventListener("mouseenter", stopAutoplay);
            box.addEventListener("mouseleave", startAutoplay);

            if (nextBtn) {
                nextBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    nextImage();
                });
            }

            if (prevBtn) {
                prevBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    prevImage();
                });
            }
        });
    }

    /* ==========================================================================
       2. MODAL PRODUKTU + POWIĘKSZANIE ZDJĘĆ (LIGHTBOX)
       ========================================================================== */
    function openProductModalHandler(productId) {
        const product = CONFIG.products.find(p => p.id === productId);
        if (!product) return;

        currentSelectedProduct = product;
        selectedSize = product.hasSizes && product.sizes.length > 0 ? product.sizes[0] : null;
        selectedColor = product.hasColors && product.colors.length > 0 ? product.colors[0] : null;

        const imageList = getProductImages(product);

        productModalContent.innerHTML = `
            <div class="product-modal-grid">
                <div class="modal-image-col">
                    <div class="modal-gallery-container">
                        <img src="${imageList[0]}" alt="${product.name}" class="modal-product-image zoomable-image" id="mainModalImage" title="Kliknij, aby powiększyć">
                        <span class="zoom-hint">🔍 Kliknij zdjęcie, aby powiększyć</span>
                    </div>
                    ${imageList.length > 1 ? `
                        <div class="modal-thumbnails">
                            ${imageList.map((img, idx) => `
                                <img src="${img}" class="modal-thumb ${idx === 0 ? 'active' : ''}" data-src="${img}" alt="Miniatura ${idx + 1}">
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                <div class="modal-product-details">
                    <h2>${product.name}</h2>
                    <div class="modal-product-price">~${product.price} PLN</div>
                    <p class="modal-product-desc">${product.description}</p>

                    ${product.hasSizes && product.sizes.length > 0 ? `
                        <div class="option-group">
                            <label>Wybierz Rozmiar:</label>
                            <div class="size-selector">
                                ${product.sizes.map((size, idx) => `
                                    <button class="size-btn ${idx === 0 ? 'active' : ''}" data-size="${size}">${size}</button>
                                `).join("")}
                            </div>
                        </div>
                    ` : ''}

                    ${product.hasColors && product.colors.length > 0 ? `
                        <div class="option-group">
                            <label>Wybierz Wariant / Kolor:</label>
                            <div class="color-selector">
                                ${product.colors.map((color, idx) => `
                                    <button class="color-btn ${idx === 0 ? 'active' : ''}" data-color="${color}">${color}</button>
                                `).join("")}
                            </div>
                        </div>
                    ` : ''}

                    <div class="option-group">
                        <label>Ilość sztuk (zapytanie):</label>
                        <div class="quantity-control">
                            <button class="qty-btn" id="qtyMinus">-</button>
                            <input type="number" id="qtyInput" class="qty-input" value="1" min="1" max="50">
                            <button class="qty-btn" id="qtyPlus">+</button>
                        </div>
                    </div>

                    <div style="margin-top: 25px;">
                        <button class="btn btn-primary" id="addToCartBtn" style="width: 100%;">
                            DODAJ DO LISTY ZAPYTAŃ
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Podgląd miniatur w modalu
        const mainImg = document.getElementById("mainModalImage");
        const thumbs = productModalContent.querySelectorAll(".modal-thumb");
        thumbs.forEach(thumb => {
            thumb.addEventListener("click", () => {
                thumbs.forEach(t => t.classList.remove("active"));
                thumb.classList.add("active");
                mainImg.src = thumb.getAttribute("data-src");
            });
        });

        // Powiększanie pełnoekranowe (Lightbox)
        mainImg.addEventListener("click", () => {
            openLightbox(mainImg.src);
        });

        if (product.hasSizes) {
            const sizeBtns = productModalContent.querySelectorAll(".size-btn");
            sizeBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    sizeBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectedSize = btn.getAttribute("data-size");
                });
            });
        }

        if (product.hasColors) {
            const colorBtns = productModalContent.querySelectorAll(".color-btn");
            colorBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    colorBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectedColor = btn.getAttribute("data-color");
                });
            });
        }

        const qtyInput = document.getElementById("qtyInput");
        document.getElementById("qtyMinus").addEventListener("click", () => {
            let val = parseInt(qtyInput.value) || 1;
            if (val > 1) qtyInput.value = val - 1;
        });
        document.getElementById("qtyPlus").addEventListener("click", () => {
            let val = parseInt(qtyInput.value) || 1;
            qtyInput.value = val + 1;
        });

        document.getElementById("addToCartBtn").addEventListener("click", () => {
            const qty = parseInt(qtyInput.value) || 1;
            addToCart(product, selectedSize, selectedColor, qty);
            renderCartItems(); 
            
            cartModal.classList.add("active");
            productModal.classList.remove("active");
            document.body.style.overflow = "hidden";
        });

        openModal(productModal);
    }

    /* ==========================================================================
       3. PEŁNOEKRANOWY LIGHTBOX
       ========================================================================== */
    function openLightbox(src) {
        let lightbox = document.getElementById("customLightbox");
        if (!lightbox) {
            lightbox = document.createElement("div");
            lightbox.id = "customLightbox";
            lightbox.className = "lightbox-overlay";
            lightbox.innerHTML = `
                <span class="lightbox-close">&times;</span>
                <img class="lightbox-image" src="" alt="Powiększenie">
            `;
            document.body.appendChild(lightbox);

            lightbox.addEventListener("click", (e) => {
                if (e.target.classList.contains("lightbox-overlay") || e.target.classList.contains("lightbox-close")) {
                    lightbox.classList.remove("active");
                }
            });
        }

        lightbox.querySelector(".lightbox-image").src = src;
        lightbox.classList.add("active");
    }

    /* ==========================================================================
       4. LOGIKA KOSZYKA / ZAPYTAŃ
       ========================================================================== */
    function addToCart(product, size, color, quantity) {
        const itemKey = `${product.id}_${size || 'nosize'}_${color || 'nocolor'}`;
        const existingIndex = cart.findIndex(item => item.key === itemKey);

        if (existingIndex > -1) {
            cart[existingIndex].quantity += quantity;
        } else {
            cart.push({
                key: itemKey,
                id: product.id,
                name: product.name,
                category: product.category,
                price: product.price,
                size: size,
                color: color,
                quantity: quantity
            });
        }

        saveCart();
        updateCartUI();
    }

    function updateItemQuantity(key, newQuantity) {
        const item = cart.find(i => i.key === key);
        if (!item) return;

        if (newQuantity <= 0) {
            removeFromCart(key);
        } else {
            item.quantity = newQuantity;
            saveCart();
            updateCartUI();
            renderCartItems();
        }
    }

    function removeFromCart(key) {
        cart = cart.filter(item => item.key !== key);
        saveCart();
        updateCartUI();
        renderCartItems();
    }

    function saveCart() {
        localStorage.setItem("spokultura_inquiry_cart", JSON.stringify(cart));
    }

    function updateCartUI() {
        const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
        if (cartCountBadge) cartCountBadge.textContent = totalCount;
        if (heroCartCount) heroCartCount.textContent = totalCount;
        if (barCartCount) barCartCount.textContent = totalCount;
    }

    function renderCartItems() {
        if (!cartItemsList) return;

        if (cart.length === 0) {
            cartItemsList.innerHTML = `
                <div style="text-align: center; padding: 30px 10px; color: rgba(255,255,255,0.5);">
                    Twoja lista zapytań jest pusta.<br>Wybierz przedmioty z katalogu powyżej.
                </div>
            `;
            if (cartTotalQuantity) cartTotalQuantity.textContent = "0 szt.";
            if (cartTotalPrice) cartTotalPrice.textContent = "0 PLN";
            if (proceedToInquiryBtn) proceedToInquiryBtn.style.display = "none";
            return;
        }

        if (proceedToInquiryBtn) proceedToInquiryBtn.style.display = "inline-flex";

        let totalQty = 0;
        let totalPrice = 0;

        cart.forEach(item => {
            totalQty += item.quantity;
            totalPrice += item.price * item.quantity;
        });

        let itemsHTML = cart.map(item => {
            const details = [
                item.size ? `Rozmiar: ${item.size}` : null,
                item.color ? `Wariant: ${item.color}` : null
            ].filter(Boolean).join(" | ");

            return `
                <div class="cart-item-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.08);">
                    <div class="cart-item-info" style="flex: 1; padding-right: 10px;">
                        <h4 style="margin: 0 0 4px 0; font-size: 0.95rem;">${item.name}</h4>
                        <p style="margin: 0; font-size: 0.8rem; color: rgba(255,255,255,0.6);">${details}</p>
                    </div>
                    <div class="cart-item-actions" style="display: flex; align-items: center; gap: 12px;">
                        <div class="quantity-control" style="display: flex; align-items: center; background: rgba(255,255,255,0.05); border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
                            <button class="cart-qty-btn cart-qty-minus" data-key="${item.key}">-</button>
                            <span style="padding: 0 4px; font-size: 0.85rem; min-width: 20px; text-align: center;">${item.quantity}</span>
                            <button class="cart-qty-btn cart-qty-plus" data-key="${item.key}">+</button>
                        </div>
                        <span style="font-weight: 800; color: #ff6a00; min-width: 65px; text-align: right; font-size: 0.9rem;">~${item.price * item.quantity} PLN</span>
                        <button class="remove-item-btn" data-key="${item.key}" title="Usuń">&times;</button>
                    </div>
                </div>
            `;
        }).join("");

        cartItemsList.innerHTML = itemsHTML;

        if (cartTotalQuantity) cartTotalQuantity.textContent = `${totalQty} szt.`;
        if (cartTotalPrice) cartTotalPrice.textContent = `~${totalPrice} PLN`;

        cartItemsList.querySelectorAll(".cart-qty-minus").forEach(btn => {
            btn.addEventListener("click", () => {
                const key = btn.getAttribute("data-key");
                const item = cart.find(i => i.key === key);
                if (item) updateItemQuantity(key, item.quantity - 1);
            });
        });

        cartItemsList.querySelectorAll(".cart-qty-plus").forEach(btn => {
            btn.addEventListener("click", () => {
                const key = btn.getAttribute("data-key");
                const item = cart.find(i => i.key === key);
                if (item) updateItemQuantity(key, item.quantity + 1);
            });
        });

        cartItemsList.querySelectorAll(".remove-item-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                removeFromCart(btn.getAttribute("data-key"));
            });
        });
    }

    /* ==========================================================================
       5. FORMULARZ I MODALE
       ========================================================================== */
    function prepareInquiryForm() {
        if (cart.length === 0) return;

        let totalQty = 0;
        let totalPrice = 0;
        let summaryTextArr = [];
        let htmlSummary = "<ul>";

        cart.forEach(item => {
            totalQty += item.quantity;
            const itemTotal = item.price * item.quantity;
            totalPrice += itemTotal;

            const itemDesc = `${item.name} [Rozmiar: ${item.size || 'N/A'}, Wariant: ${item.color || 'N/A'}] x ${item.quantity} szt. (~${itemTotal} PLN)`;
            summaryTextArr.push(itemDesc);
            htmlSummary += `<li style="margin-bottom: 4px; color: rgba(255,255,255,0.85);">${itemDesc}</li>`;
        });

        htmlSummary += "</ul>";

        if (inquiryItemsSummary) inquiryItemsSummary.innerHTML = htmlSummary;
        if (formCartDataHidden) formCartDataHidden.value = summaryTextArr.join("\n");
        if (formTotalHidden) formTotalHidden.value = `Łącznie sztuk: ${totalQty}, Szacowana wartość: ~${totalPrice} PLN`;
    }

    if (inquiryForm) {
        inquiryForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (cart.length === 0) return;

            submitInquiryBtn.disabled = true;
            submitInquiryBtn.textContent = "WYSYŁANIE...";

            try {
                const response = await fetch(inquiryForm.action, {
                    method: 'POST',
                    body: new FormData(inquiryForm),
                    headers: { 'Accept': 'application/json' }
                });

                if (response.ok) {
                    alert("Dziękujemy! Zapytanie zostało wysłane.");
                    cart = [];
                    saveCart();
                    updateCartUI();
                    inquiryForm.reset();
                    closeModal(inquiryModal);
                } else {
                    alert("Wystąpił problem z wysyłką.");
                }
            } catch (error) {
                alert("Błąd połączenia.");
            } finally {
                submitInquiryBtn.disabled = false;
                submitInquiryBtn.textContent = "WYŚLIJ ZAPYTANIE";
            }
        });
    }

    function openModal(modal) {
        if (!modal) return;
        modal.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove("active");
        document.body.style.overflow = "";
    }

    const triggerCartOpen = () => {
        renderCartItems();
        openModal(cartModal);
    };

    if (openCartBtn) openCartBtn.addEventListener("click", triggerCartOpen);
    if (heroCartBtn) heroCartBtn.addEventListener("click", triggerCartOpen);
    if (barCartBtn) barCartBtn.addEventListener("click", triggerCartOpen);

    if (closeProductModal) closeProductModal.addEventListener("click", () => closeModal(productModal));
    if (closeCartModal) closeCartModal.addEventListener("click", () => closeModal(cartModal));
    if (closeInquiryModal) closeInquiryModal.addEventListener("click", () => closeModal(inquiryModal));

    if (continueShoppingBtn) continueShoppingBtn.addEventListener("click", () => closeModal(cartModal));

    if (proceedToInquiryBtn) {
        proceedToInquiryBtn.addEventListener("click", () => {
            inquiryModal.classList.add("active");
            cartModal.classList.remove("active");
            prepareInquiryForm();
        });
    }

    if (backToCartBtn) {
        backToCartBtn.addEventListener("click", () => {
            renderCartItems();
            cartModal.classList.add("active");
            inquiryModal.classList.remove("active");
        });
    }

    [productModal, cartModal, inquiryModal].forEach(modal => {
        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) closeModal(modal);
            });
        }
    });

    renderProductsGrid();
    updateCartUI();
});