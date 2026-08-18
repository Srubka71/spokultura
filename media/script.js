/**
 * Spokultura - Główny plik script.js
 * Obsługa: Oceny, Komentarze, Wyświetlenia, Wyszukiwarka, Filtry, Albumy (Galeria) oraz Pełnoekranowy Podgląd (Lightbox)
 */
(() => {
    'use strict';

    // 1. Zabezpieczenie przed ponowną inicjalizacją skryptu
    if (window.__SPOKULTURA_SCRIPT_LOADED__) {
        console.warn('script.js został już załadowany. Przerwanie ponownej inicjalizacji.');
        return;
    }
    window.__SPOKULTURA_SCRIPT_LOADED__ = true;

    // Pomocnicza funkcja do zamiany linku YouTube na URL Embed dla iframe
    function formatYouTubeEmbedUrl(url) {
        if (!url) return '';
        if (url.includes('youtube.com/embed/')) return url;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? `https://www.youtube.com/embed/${match[2]}` : url;
    }

    // 2. Główna logika aplikacji
    const initApp = async () => {

        /* SUPABASE CONFIGURATION */
        const SUPABASE_URL = "https://hlruehdtrwfrfagqoyve.supabase.co";
        const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscnVlaGR0cndmcmZhZ3FveXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTE3ODEsImV4cCI6MjA5NDI2Nzc4MX0.W3KbmBFpkAkI7y81HfDzUyUL8n8b85i33qENiXJYLDA";

        let supabaseClient = null;
        if (window.supabase) {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        /* FILTR SŁÓW OBRAŹLIWYCH */
        const FORBIDDEN_WORDS = ["kurw", "chuj", "pizd", "jeb", "skurw", "suka", "dziwka", "debil"];

        function containsProfanity(text) {
            if (!text) return false;
            const normalizedText = text.toLowerCase();
            return FORBIDDEN_WORDS.some(word => normalizedText.includes(word));
        }

        /* TOAST NOTIFICATIONS */
        function showToast(message) {
            const container = document.getElementById("toastContainer");
            if (!container) return;
            const toast = document.createElement("div");
            toast.className = "toast";
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        /* VISITOR ID */
        function getVisitorId() {
            let visitorId = localStorage.getItem("spokultura_visitor_id");
            if (!visitorId) {
                visitorId = "visitor_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
                localStorage.setItem("spokultura_visitor_id", visitorId);
            }
            return visitorId;
        }

        const visitorId = getVisitorId();

        /* DOM ELEMENTS */
        const mediaGrid = document.getElementById("mediaGrid");
        const emptyState = document.getElementById("emptyState");
        const filterButtons = document.querySelectorAll(".filter-button");
        const sortSelect = document.getElementById("sortSelect");
        const searchInput = document.getElementById("searchInput");

        // Modal elements
        const mediaModal = document.getElementById("mediaModal");
        const modalClose = document.getElementById("modalClose");
        const modalTitle = document.getElementById("modalTitle");
        const modalSubtitle = document.getElementById("modalSubtitle");
        const modalText = document.getElementById("modalText");
        const modalStars = document.getElementById("modalStars");
        const modalRatingNum = document.getElementById("modalRatingNum");
        const modalVotesCount = document.getElementById("modalVotesCount");
        const modalViewsCount = document.getElementById("modalViewsCount");
        const shareBtn = document.getElementById("shareBtn");

        // Comment elements
        const commentForm = document.getElementById("commentForm");
        const commentAuthor = document.getElementById("commentAuthor");
        const commentText = document.getElementById("commentText");
        const commentsList = document.getElementById("commentsList");
        const commentError = document.getElementById("commentError");

        let currentFilter = "all";
        let currentSort = "date-desc";
        let searchQuery = "";
        let supabaseRatings = {};
        let commentCounts = {};
        let itemViews = {};
        let activeMediaItem = null;

        let currentGalleryIndex = 0;
        let currentGalleryItems = [];

        /* PEŁNOEKRANOWY PODGLĄD ZDJĘCIA (LIGHTBOX) */
        function openFullscreenImage(src, altText) {
            let lightbox = document.getElementById("fullscreenLightbox");
            
            if (!lightbox) {
                lightbox = document.createElement("div");
                lightbox.id = "fullscreenLightbox";
                lightbox.className = "fullscreen-lightbox";
                lightbox.innerHTML = `
                    <span class="lightbox-close" id="lightboxClose" title="Zamknij (Esc)">&times;</span>
                    <div class="lightbox-content-wrapper">
                        <img src="" alt="" class="lightbox-img" id="lightboxImg">
                    </div>
                `;
                document.body.appendChild(lightbox);

                lightbox.addEventListener("click", (e) => {
                    if (e.target === lightbox || e.target.classList.contains("lightbox-content-wrapper") || e.target.id === "lightboxClose") {
                        closeFullscreenImage();
                    }
                });
            }

            const imgEl = lightbox.querySelector("#lightboxImg");
            imgEl.src = src;
            imgEl.alt = altText || "";

            lightbox.classList.add("active");
        }

        function closeFullscreenImage() {
            const lightbox = document.getElementById("fullscreenLightbox");
            if (lightbox) {
                lightbox.classList.remove("active");
            }
        }

        /* FETCH STATS FROM SUPABASE */
        async function loadStatsFromSupabase() {
            if (!supabaseClient) return;

            try {
                const { data: ratingsData } = await supabaseClient
                    .from("media_ratings")
                    .select("media_id, average_rating, total_votes");

                if (ratingsData) {
                    supabaseRatings = {};
                    ratingsData.forEach(row => {
                        supabaseRatings[String(row.media_id)] = {
                            rating: Number(row.average_rating) || 0,
                            totalVotes: Number(row.total_votes) || 0
                        };
                    });
                }

                const { data: commentsData } = await supabaseClient
                    .from("media_comments")
                    .select("media_id");

                if (commentsData) {
                    commentCounts = {};
                    commentsData.forEach(row => {
                        const key = String(row.media_id);
                        commentCounts[key] = (commentCounts[key] || 0) + 1;
                    });
                }

                const { data: viewsData } = await supabaseClient
                    .from("media_views")
                    .select("media_id");

                if (viewsData) {
                    itemViews = {};
                    viewsData.forEach(row => {
                        const key = String(row.media_id);
                        itemViews[key] = (itemViews[key] || 0) + 1;
                    });
                }
            } catch (err) {
                console.error("Błąd połączenia z Supabase:", err);
            }
        }

        /* SUBMIT RATING */
        async function submitRating(mediaId, score) {
            if (!supabaseClient) return;

            try {
                const { error } = await supabaseClient
                    .from("media_votes")
                    .upsert({
                        media_id: String(mediaId),
                        visitor_id: visitorId,
                        score: Number(score),
                        updated_at: new Date().toISOString()
                    }, { onConflict: "media_id, visitor_id" });

                if (!error) {
                    showToast("Dziękujemy za głos! ⭐");
                    await loadStatsFromSupabase();
                    renderMedia();
                    if (activeMediaItem && String(activeMediaItem.id) === String(mediaId)) {
                        updateModalRatingUI(mediaId);
                    }
                } else {
                    console.error("Błąd zapisu głosu w bazie:", error);
                    showToast("Nie udało się zapisać głosu.");
                }
            } catch (err) {
                console.error("Błąd oceniania:", err);
            }
        }

        /* GENERATE STARS HTML */
        function generateStarsHTML(rating, mediaId) {
            const fullStars = Math.floor(rating);
            const hasHalf = rating % 1 >= 0.5;
            let starsHTML = "";

            for (let i = 1; i <= 5; i++) {
                let starChar = "☆";
                if (i <= fullStars || (i === fullStars + 1 && hasHalf)) {
                    starChar = "★";
                }
                starsHTML += `<span class="star-clickable" data-media-id="${mediaId}" data-star="${i}">${starChar}</span>`;
            }
            return starsHTML;
        }

        /* RENDER MEDIA CARDS */
        function renderMedia() {
            if (!mediaGrid) return;
            const rawItems = (typeof MEDIA_ITEMS !== "undefined") ? MEDIA_ITEMS : [];

            const sortedByDate = [...rawItems].sort((a, b) => new Date(b.date) - new Date(a.date));
            const newestIds = sortedByDate.slice(0, 2).map(item => String(item.id));

            let items = rawItems.map(item => {
                const strId = String(item.id);
                const dbData = supabaseRatings[strId];
                return {
                    ...item,
                    rating: dbData ? dbData.rating : 0,
                    totalVotes: dbData ? dbData.totalVotes : 0,
                    commentsCount: commentCounts[strId] || 0,
                    viewsCount: itemViews[strId] || 0,
                    isNew: newestIds.includes(strId)
                };
            });

            if (searchQuery.trim() !== "") {
                const query = searchQuery.toLowerCase();
                items = items.filter(item => 
                    item.title.toLowerCase().includes(query) || 
                    (item.description && item.description.toLowerCase().includes(query))
                );
            }

            if (currentFilter !== "all") {
                items = items.filter(item => item.type === currentFilter);
            }

            switch (currentSort) {
                case "date-desc": items.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
                case "date-asc": items.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
                case "rating-desc": items.sort((a, b) => Number(b.rating) - Number(a.rating)); break;
                case "rating-asc": items.sort((a, b) => Number(a.rating) - Number(b.rating)); break;
            }

            if (items.length === 0) {
                mediaGrid.innerHTML = "";
                if (emptyState) emptyState.hidden = false;
                return;
            }

            if (emptyState) emptyState.hidden = true;
            mediaGrid.innerHTML = "";

            items.forEach(item => {
                const card = document.createElement("article");
                card.className = `media-card ${item.type}`;

                const image = item.thumbnail || item.image || "assets/thumbnails/placeholder.jpg";
                
                let typeLabel = "PHOTO";
                if (item.type === "video") typeLabel = "VIDEO";
                else if (item.type === "album" || item.type === "photos+videos") typeLabel = "ALBUM";

                const rating = Number(item.rating || 0);

                card.innerHTML = `
                    <div class="media-card-image">
                        <img src="${image}" alt="${escapeHTML(item.title)}" loading="lazy">
                        <span class="media-type">${typeLabel}</span>
                        ${item.isNew ? '<span class="badge-new">NOWOŚĆ</span>' : ''}
                    </div>

                    <div class="media-card-content">
                        <div>
                            <h2>${escapeHTML(item.title)}</h2>
                            <h3>${escapeHTML(item.subtitle || "")}</h3>
                            <p class="media-description">${escapeHTML(item.description || "")}</p>
                        </div>

                        <div class="rating-box">
                            <span class="stars">${generateStarsHTML(rating, item.id)}</span>
                            <span class="rating-number">${rating.toFixed(1)}</span>
                            <span class="rating-info">(${item.totalVotes} głosów | ${item.commentsCount} kom.)</span>
                        </div>
                    </div>

                    <div class="media-card-arrow" title="Otwórz wpis">
                        &#10140;
                    </div>
                `;

                card.addEventListener("mousemove", (e) => {
                    const rect = card.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    const rotateX = ((y - centerY) / centerY) * -5;
                    const rotateY = ((x - centerX) / centerX) * 5;

                    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
                });

                card.addEventListener("mouseleave", () => {
                    card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
                });

                card.addEventListener("click", (e) => {
                    const starTarget = e.target.closest(".star-clickable");
                    if (starTarget) {
                        e.preventDefault();
                        e.stopPropagation();
                        const score = Number(starTarget.dataset.star);
                        submitRating(item.id, score);
                        return;
                    }
                    openModal(item);
                });

                mediaGrid.appendChild(card);
            });
        }

        /* DELEGACJA ZDARZEŃ DLA GWIAZDEK W MODALU (NAPRAWIONY KONFLIKT) */
        if (modalStars) {
            modalStars.addEventListener("click", (e) => {
                const starEl = e.target.closest(".star-clickable");
                if (starEl && activeMediaItem) {
                    e.preventDefault();
                    e.stopPropagation();
                    const score = Number(starEl.dataset.star);
                    submitRating(activeMediaItem.id, score);
                }
            });
        }

        /* MODAL & GALLERY LOGIC */
        async function openModal(item) {
            if (!mediaModal) return;
            activeMediaItem = item;

            if (modalTitle) modalTitle.textContent = item.title;
            if (modalSubtitle) modalSubtitle.textContent = item.subtitle || "";
            if (modalText) modalText.textContent = item.description || "Brak opisu.";
            if (commentError) commentError.style.display = "none";

            currentGalleryItems = item.gallery;
            if (!currentGalleryItems || !Array.isArray(currentGalleryItems) || currentGalleryItems.length === 0) {
                currentGalleryItems = [];
                if (item.videoUrl) {
                    currentGalleryItems.push({ type: 'video', url: item.videoUrl });
                }
                const mainImg = item.image || item.thumbnail || "assets/thumbnails/placeholder.jpg";
                currentGalleryItems.push({ type: 'image', url: mainImg });
            }

            currentGalleryIndex = 0;

            let mediaContainer = document.getElementById("modalMediaContainer");
            if (!mediaContainer) {
                mediaContainer = document.createElement("div");
                mediaContainer.id = "modalMediaContainer";
                mediaContainer.className = "modal-media-container";
                if (modalImg && modalImg.parentNode) {
                    modalImg.parentNode.replaceChild(mediaContainer, modalImg);
                }
            }

            mediaContainer.innerHTML = `
                <div class="modal-main-display"></div>
                ${currentGalleryItems.length > 1 ? `
                    <button class="modal-nav-arrow prev" title="Poprzednie (Klawisz ←)">&#10094;</button>
                    <button class="modal-nav-arrow next" title="Następne (Klawisz →)">&#10095;</button>
                    <div class="modal-gallery-thumbs"></div>
                ` : ''}
            `;

            const displayArea = mediaContainer.querySelector(".modal-main-display");
            const thumbsContainer = mediaContainer.querySelector(".modal-gallery-thumbs");

            function renderActiveMedia(index) {
                currentGalleryIndex = index;
                const media = currentGalleryItems[index];

                if (media.type === 'video') {
                    const embedUrl = formatYouTubeEmbedUrl(media.url);
                    displayArea.innerHTML = `
                        <div class="video-responsive">
                            <iframe src="${embedUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                        </div>`;
                } else {
                    displayArea.innerHTML = `<img src="${media.url}" alt="${escapeHTML(item.title)}" class="modal-main-img" title="Kliknij, aby powiększyć na pełny ekran">`;
                    
                    const imgEl = displayArea.querySelector(".modal-main-img");
                    if (imgEl) {
                        imgEl.addEventListener("click", (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openFullscreenImage(media.url, item.title);
                        });
                    }
                }

                if (thumbsContainer) {
                    const thumbs = thumbsContainer.querySelectorAll(".gallery-thumb");
                    thumbs.forEach((t, i) => {
                        t.classList.toggle("active", i === index);
                        if (i === index) {
                            t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                        }
                    });
                }
            }

            if (thumbsContainer) {
                currentGalleryItems.forEach((media, index) => {
                    const thumb = document.createElement("div");
                    thumb.className = `gallery-thumb ${index === 0 ? 'active' : ''}`;
                    
                    if (media.type === 'video') {
                        thumb.innerHTML = `<span class="thumb-icon">▶</span> Wideo`;
                    } else {
                        thumb.innerHTML = `<img src="${media.url}" alt="thumb">`;
                    }

                    thumb.addEventListener("click", () => renderActiveMedia(index));
                    thumbsContainer.appendChild(thumb);
                });
            }

            const prevBtn = mediaContainer.querySelector(".modal-nav-arrow.prev");
            const nextBtn = mediaContainer.querySelector(".modal-nav-arrow.next");

            if (prevBtn) {
                prevBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const newIndex = (currentGalleryIndex - 1 + currentGalleryItems.length) % currentGalleryItems.length;
                    renderActiveMedia(newIndex);
                });
            }

            if (nextBtn) {
                nextBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const newIndex = (currentGalleryIndex + 1) % currentGalleryItems.length;
                    renderActiveMedia(newIndex);
                });
            }

            renderActiveMedia(0);
            history.replaceState(null, "", `#${item.id}`);

            const viewedSessionKey = `viewed_${item.id}`;
            if (!sessionStorage.getItem(viewedSessionKey)) {
                sessionStorage.setItem(viewedSessionKey, "true");
                if (supabaseClient) {
                    supabaseClient.from("media_views").insert({ media_id: String(item.id) }).then(() => {
                        itemViews[String(item.id)] = (itemViews[String(item.id)] || 0) + 1;
                        if (modalViewsCount) modalViewsCount.textContent = `👁️ ${itemViews[String(item.id)]} wyświetleń`;
                        renderMedia();
                    });
                }
            }

            updateModalRatingUI(item.id);
            await loadComments(item.id);

            mediaModal.classList.add("active");
            document.body.style.overflow = "hidden";
        }

        function closeModal() {
            if (!mediaModal) return;
            
            closeFullscreenImage();

            mediaModal.classList.remove("active");
            document.body.style.overflow = "auto";
            
            const mediaContainer = document.getElementById("modalMediaContainer");
            if (mediaContainer) {
                mediaContainer.innerHTML = '';
            }

            activeMediaItem = null;
            history.replaceState(null, "", window.location.pathname + window.location.search);
        }

        if (modalClose) modalClose.addEventListener("click", closeModal);
        if (mediaModal) {
            mediaModal.addEventListener("click", (e) => {
                if (e.target === mediaModal) closeModal();
            });
        }

        document.addEventListener("keydown", (e) => {
            const lightbox = document.getElementById("fullscreenLightbox");

            if (e.key === "Escape") {
                if (lightbox && lightbox.classList.contains("active")) {
                    closeFullscreenImage();
                    return;
                }
                if (mediaModal && mediaModal.classList.contains("active")) {
                    closeModal();
                    return;
                }
            }

            if (!mediaModal || !mediaModal.classList.contains("active")) return;

            if (e.key === "ArrowLeft" && currentGalleryItems.length > 1) {
                const prevBtn = document.querySelector(".modal-nav-arrow.prev");
                if (prevBtn) prevBtn.click();
            } else if (e.key === "ArrowRight" && currentGalleryItems.length > 1) {
                const nextBtn = document.querySelector(".modal-nav-arrow.next");
                if (nextBtn) nextBtn.click();
            }
        });

        if (shareBtn) {
            shareBtn.addEventListener("click", () => {
                if (!activeMediaItem) return;
                
                const shareUrl = `${window.location.origin}${window.location.pathname}#${activeMediaItem.id}`;
                
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(shareUrl).then(() => {
                        showToast("Unikalny link skopiowany! 🔗");
                    });
                }
            });
        }

        function updateModalRatingUI(mediaId) {
            const strId = String(mediaId);
            const dbData = supabaseRatings[strId];
            const rating = dbData ? dbData.rating : 0;
            const totalVotes = dbData ? dbData.totalVotes : 0;
            const cCount = commentCounts[strId] || 0;
            const vCount = itemViews[strId] || 0;

            if (modalStars) modalStars.innerHTML = generateStarsHTML(rating, strId);
            if (modalRatingNum) modalRatingNum.textContent = `${rating.toFixed(1)} / 5`;
            if (modalVotesCount) modalVotesCount.textContent = `(${totalVotes} głosów | ${cCount} komentarzy)`;
            if (modalViewsCount) modalViewsCount.textContent = `👁️ ${vCount} wyświetleń`;
        }

        async function loadComments(mediaId) {
            if (!commentsList) return;
            commentsList.innerHTML = "<p style='font-size:0.8rem; color:#888;'>Ładowanie komentarzy...</p>";
            if (!supabaseClient) return;

            try {
                const { data, error } = await supabaseClient
                    .from("media_comments")
                    .select("*")
                    .eq("media_id", String(mediaId))
                    .order("created_at", { ascending: false });

                if (error) throw error;

                if (!data || data.length === 0) {
                    commentsList.innerHTML = "<p style='font-size:0.8rem; color:#666;'>Brak komentarzy. Bądź pierwszy!</p>";
                    return;
                }

                commentsList.innerHTML = "";
                data.forEach(c => {
                    const commentEl = document.createElement("div");
                    commentEl.className = "comment-item";
                    const dateFormatted = new Date(c.created_at).toLocaleDateString("pl-PL", {
                        hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit"
                    });

                    commentEl.innerHTML = `
                        <div>
                            <span class="comment-author">${escapeHTML(c.author_name)}</span>
                            <span class="comment-date">${dateFormatted}</span>
                        </div>
                        <div class="comment-text">${escapeHTML(c.comment_text)}</div>
                    `;
                    commentsList.appendChild(commentEl);
                });
            } catch (err) {
                console.error("Błąd ładowania komentarzy:", err);
                commentsList.innerHTML = "<p style='font-size:0.8rem; color:#f00;'>Nie udało się załadować komentarzy.</p>";
            }
        }

        if (commentForm) {
            commentForm.addEventListener("submit", async (e) => {
                e.preventDefault();
                if (!activeMediaItem || !supabaseClient) return;

                if (commentError) commentError.style.display = "none";

                const author = commentAuthor ? commentAuthor.value.trim() || "Anonim" : "Anonim";
                const text = commentText ? commentText.value.trim() : "";

                if (containsProfanity(author) || containsProfanity(text)) {
                    if (commentError) {
                        commentError.textContent = "Twój nick lub komentarz zawiera zabronione słowa.";
                        commentError.style.display = "block";
                    }
                    return;
                }

                const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');
                if (!turnstileResponse || !turnstileResponse.value) {
                    if (commentError) {
                        commentError.textContent = "Proszę ukończyć weryfikację Turnstile.";
                        commentError.style.display = "block";
                    }
                    return;
                }

                try {
                    const { error } = await supabaseClient
                        .from("media_comments")
                        .insert({
                            media_id: String(activeMediaItem.id),
                            author_name: author,
                            comment_text: text
                        });

                    if (!error) {
                        if (commentText) commentText.value = "";
                        if (window.turnstile) turnstile.reset();
                        showToast("Komentarz został opublikowany! 💬");
                        await loadStatsFromSupabase();
                        renderMedia();
                        updateModalRatingUI(activeMediaItem.id);
                        await loadComments(activeMediaItem.id);
                    } else {
                        if (commentError) {
                            commentError.textContent = "Błąd zapisu komentarza.";
                            commentError.style.display = "block";
                        }
                    }
                } catch (err) {
                    console.error("Błąd dodawania komentarza:", err);
                }
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                searchQuery = e.target.value;
                renderMedia();
            });
        }

        filterButtons.forEach(button => {
            button.addEventListener("click", () => {
                filterButtons.forEach(btn => btn.classList.remove("active"));
                button.classList.add("active");
                currentFilter = button.dataset.filter;
                renderMedia();
            });
        });

        if (sortSelect) {
            sortSelect.addEventListener("change", event => {
                currentSort = event.target.value;
                renderMedia();
            });
        }

        function escapeHTML(value) {
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&#039;");
        }

        function checkHashAndOpenModal() {
            if (window.location.hash) {
                const hashId = window.location.hash.substring(1);
                const rawItems = (typeof MEDIA_ITEMS !== "undefined") ? MEDIA_ITEMS : [];
                const targetItem = rawItems.find(item => String(item.id) === String(hashId));
                if (targetItem) {
                    openModal(targetItem);
                }
            }
        }

        await loadStatsFromSupabase();
        renderMedia();
        checkHashAndOpenModal();

        window.addEventListener("hashchange", checkHashAndOpenModal);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
