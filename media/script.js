document.addEventListener("DOMContentLoaded", async () => {

    /* SUPABASE CONFIGURATION */
    const SUPABASE_URL = "https://hlruehdtrwfrfagqoyve.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscnVlaGR0cndmcmZhZ3FveXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTE3ODEsImV4cCI6MjA5NDI2Nzc4MX0.W3KbmBFpkAkI7y81HfDzUyUL8n8b85i33qENiXJYLDA";

    let supabaseClient = null;
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    /* FILTR SLOW OBRAŹLIWYCH */
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
    const modalImg = document.getElementById("modalImg");
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

    /* FETCH STATS FROM SUPABASE */
    async function loadStatsFromSupabase() {
        if (!supabaseClient) return;

        try {
            // Oceny
            const { data: ratingsData } = await supabaseClient
                .from("media_ratings")
                .select("media_id, average_rating, total_votes");

            if (ratingsData) {
                ratingsData.forEach(row => {
                    supabaseRatings[row.media_id] = {
                        rating: Number(row.average_rating) || 0,
                        totalVotes: Number(row.total_votes) || 0
                    };
                });
            }

            // Komentarze
            const { data: commentsData } = await supabaseClient
                .from("media_comments")
                .select("media_id");

            if (commentsData) {
                commentCounts = {};
                commentsData.forEach(row => {
                    commentCounts[row.media_id] = (commentCounts[row.media_id] || 0) + 1;
                });
            }

            // Wyświetlenia
            const { data: viewsData } = await supabaseClient
                .from("media_views")
                .select("media_id");

            if (viewsData) {
                itemViews = {};
                viewsData.forEach(row => {
                    itemViews[row.media_id] = (itemViews[row.media_id] || 0) + 1;
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
                    media_id: mediaId,
                    visitor_id: visitorId,
                    score: score,
                    updated_at: new Date().toISOString()
                }, { onConflict: "media_id, visitor_id" });

            if (!error) {
                showToast("Dziękujemy za głos! ⭐");
                await loadStatsFromSupabase();
                renderMedia();
                if (activeMediaItem && activeMediaItem.id === mediaId) {
                    updateModalRatingUI(mediaId);
                }
            } else {
                console.error("Błąd zapisu głosu:", error);
            }
        } catch (err) {
            console.error("Błąd oceniania:", err);
        }
    }

    /* GENERATE STARS */
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
        const rawItems = (typeof MEDIA_ITEMS !== "undefined") ? MEDIA_ITEMS : [];

        const sortedByDate = [...rawItems].sort((a, b) => new Date(b.date) - new Date(a.date));
        const newestIds = sortedByDate.slice(0, 2).map(item => item.id);

        let items = rawItems.map(item => {
            const dbData = supabaseRatings[item.id];
            return {
                ...item,
                rating: dbData ? dbData.rating : 0,
                totalVotes: dbData ? dbData.totalVotes : 0,
                commentsCount: commentCounts[item.id] || 0,
                viewsCount: itemViews[item.id] || 0,
                isNew: newestIds.includes(item.id)
            };
        });

        // Wyszukiwarka
        if (searchQuery.trim() !== "") {
            const query = searchQuery.toLowerCase();
            items = items.filter(item => 
                item.title.toLowerCase().includes(query) || 
                (item.description && item.description.toLowerCase().includes(query))
            );
        }

        // Filtry
        if (currentFilter !== "all") {
            items = items.filter(item => item.type === currentFilter);
        }

        // Sortowanie
        switch (currentSort) {
            case "date-desc": items.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
            case "date-asc": items.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
            case "rating-desc": items.sort((a, b) => Number(b.rating) - Number(a.rating)); break;
            case "rating-asc": items.sort((a, b) => Number(a.rating) - Number(b.rating)); break;
        }

        if (items.length === 0) {
            mediaGrid.innerHTML = "";
            emptyState.hidden = false;
            return;
        }

        emptyState.hidden = true;
        mediaGrid.innerHTML = "";

        items.forEach(item => {
            const card = document.createElement("article");
            card.className = `media-card ${item.type}`;

            const image = item.thumbnail || item.image || "assets/thumbnails/placeholder.jpg";
            const typeLabel = item.type === "video" ? "VIDEO" : "PHOTO";
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

            // Efekt 3D Tilt
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

            // Otwieranie modalu przy kliknięciu w dowolne miejsce kafelka
            card.addEventListener("click", () => openModal(item));

            // Kliknięcie w gwiazdkę
            card.querySelectorAll(".star-clickable").forEach(starEl => {
                starEl.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const score = Number(starEl.dataset.star);
                    submitRating(item.id, score);
                });
            });

            mediaGrid.appendChild(card);
        });
    }

    /* MODAL AND COMMENTS LOGIC */
    async function openModal(item) {
        activeMediaItem = item;
        const image = item.image || item.thumbnail || "assets/thumbnails/placeholder.jpg";

        modalImg.src = image;
        modalTitle.textContent = item.title;
        modalSubtitle.textContent = item.subtitle || "";
        modalText.textContent = item.description || "Brak opisu.";
        
        if (commentError) commentError.style.display = "none";

        // OCHRONA PRZED NABIJAJĄCYMI SIĘ WYŚWIETLENIAMI (Zapis w sessionStorage)
        const viewedSessionKey = `viewed_${item.id}`;
        if (!sessionStorage.getItem(viewedSessionKey)) {
            sessionStorage.setItem(viewedSessionKey, "true");
            if (supabaseClient) {
                supabaseClient.from("media_views").insert({ media_id: item.id }).then(() => {
                    itemViews[item.id] = (itemViews[item.id] || 0) + 1;
                    modalViewsCount.textContent = `👁️ ${itemViews[item.id]} wyświetleń`;
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
        mediaModal.classList.remove("active");
        document.body.style.overflow = "auto";
        activeMediaItem = null;
    }

    modalClose.addEventListener("click", closeModal);
    mediaModal.addEventListener("click", (e) => {
        if (e.target === mediaModal) closeModal();
    });

    /* UDOSTĘPNIANIE LINKU */
    shareBtn.addEventListener("click", () => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                showToast("Skopiowano link! 🔗");
            });
        }
    });

    function updateModalRatingUI(mediaId) {
        const dbData = supabaseRatings[mediaId];
        const rating = dbData ? dbData.rating : 0;
        const totalVotes = dbData ? dbData.totalVotes : 0;
        const cCount = commentCounts[mediaId] || 0;
        const vCount = itemViews[mediaId] || 0;

        modalStars.innerHTML = generateStarsHTML(rating, mediaId);
        modalRatingNum.textContent = `${rating.toFixed(1)} / 5`;
        modalVotesCount.textContent = `(${totalVotes} głosów | ${cCount} komentarzy)`;
        modalViewsCount.textContent = `👁️ ${vCount} wyświetleń`;

        modalStars.querySelectorAll(".star-clickable").forEach(starEl => {
            starEl.addEventListener("click", () => {
                const score = Number(starEl.dataset.star);
                submitRating(mediaId, score);
            });
        });
    }

    /* LOAD & SUBMIT COMMENTS */
    async function loadComments(mediaId) {
        commentsList.innerHTML = "<p style='font-size:0.8rem; color:#888;'>Ładowanie komentarzy...</p>";
        if (!supabaseClient) return;

        try {
            const { data, error } = await supabaseClient
                .from("media_comments")
                .select("*")
                .eq("media_id", mediaId)
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

    commentForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!activeMediaItem || !supabaseClient) return;

        commentError.style.display = "none";

        const author = commentAuthor.value.trim() || "Anonim";
        const text = commentText.value.trim();

        if (containsProfanity(author) || containsProfanity(text)) {
            commentError.textContent = "Twój nick lub komentarz zawiera zabronione słowa.";
            commentError.style.display = "block";
            return;
        }

        const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');
        if (!turnstileResponse || !turnstileResponse.value) {
            commentError.textContent = "Proszę ukończyć weryfikację Turnstile.";
            commentError.style.display = "block";
            return;
        }

        try {
            const { error } = await supabaseClient
                .from("media_comments")
                .insert({
                    media_id: activeMediaItem.id,
                    author_name: author,
                    comment_text: text
                });

            if (!error) {
                commentText.value = "";
                if (window.turnstile) turnstile.reset();
                showToast("Komentarz został opublikowany! 💬");
                await loadStatsFromSupabase();
                renderMedia();
                updateModalRatingUI(activeMediaItem.id);
                await loadComments(activeMediaItem.id);
            } else {
                commentError.textContent = "Błąd zapisu komentarza.";
                commentError.style.display = "block";
            }
        } catch (err) {
            console.error("Błąd dodawania komentarza:", err);
        }
    });

    /* SEARCH, FILTERS & SORTING */
    searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value;
        renderMedia();
    });

    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            filterButtons.forEach(btn => btn.classList.remove("active"));
            button.classList.add("active");
            currentFilter = button.dataset.filter;
            renderMedia();
        });
    });

    sortSelect.addEventListener("change", event => {
        currentSort = event.target.value;
        renderMedia();
    });

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&#039;");
    }

    // START
    await loadStatsFromSupabase();
    renderMedia();
});
