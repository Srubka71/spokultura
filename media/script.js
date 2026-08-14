document.addEventListener("DOMContentLoaded", async () => {

    /* SUPABASE CONFIGURATION */
    const SUPABASE_URL = "https://hlruehdtrwfrfagqoyve.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscnVlaGR0cndmcmZhZ3FveXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTE3ODEsImV4cCI6MjA5NDI2Nzc4MX0.W3KbmBFpkAkI7y81HfDzUyUL8n8b85i33qENiXJYLDA";

    let supabaseClient = null;
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    /* FILTR SLOW OBRAŹLIWYCH (PROSTA LISTA BAD WORDS) */
    const FORBIDDEN_WORDS = [
        "kurw", "chuj", "pizd", "jeb", "skurw", "suka", "dziwka", "pedał", 
        "debil", "idiota", "cipa", "kutas", "spierdalaj", "fuck", "shit"
    ];

    function containsProfanity(text) {
        if (!text) return false;
        const normalizedText = text.toLowerCase()
            .replace(/0/g, 'o')
            .replace(/1/g, 'i')
            .replace(/3/g, 'e')
            .replace(/@/g, 'a')
            .replace(/\$/g, 's');

        return FORBIDDEN_WORDS.some(word => normalizedText.includes(word));
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
    
    // Comment elements
    const commentForm = document.getElementById("commentForm");
    const commentAuthor = document.getElementById("commentAuthor");
    const commentText = document.getElementById("commentText");
    const commentsList = document.getElementById("commentsList");
    const commentError = document.getElementById("commentError");

    let currentFilter = "all";
    let currentSort = "date-desc";
    let supabaseRatings = {};
    let commentCounts = {};
    let userVotes = {};
    let activeMediaItem = null;

    /* FETCH RATINGS & COMMENT COUNTS FROM SUPABASE */
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
                        rating: Number(row.average_rating),
                        totalVotes: Number(row.total_votes)
                    };
                });
            }

            // Liczba komentarzy
            const { data: commentsData } = await supabaseClient
                .from("media_comments")
                .select("media_id");

            if (commentsData) {
                commentCounts = {};
                commentsData.forEach(row => {
                    commentCounts[row.media_id] = (commentCounts[row.media_id] || 0) + 1;
                });
            }

            // Głos użytkownika
            const { data: votesData } = await supabaseClient
                .from("media_votes")
                .select("media_id, score")
                .eq("visitor_id", visitorId);

            if (votesData) {
                votesData.forEach(row => {
                    userVotes[row.media_id] = row.score;
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
                await loadStatsFromSupabase();
                renderMedia();
                if (activeMediaItem && activeMediaItem.id === mediaId) {
                    updateModalRatingUI(mediaId);
                }
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

        let items = rawItems.map(item => {
            const dbData = supabaseRatings[item.id];
            const cCount = commentCounts[item.id] || 0;
            return {
                ...item,
                rating: dbData ? dbData.rating : (item.rating || 0),
                totalVotes: dbData ? dbData.totalVotes : 0,
                commentsCount: cCount,
                userScore: userVotes[item.id] || null
            };
        });

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
                        <span class="rating-info">(${item.totalVotes} głosów | ${item.commentsCount} komentarzy)</span>
                    </div>
                </div>

                <div class="media-card-arrow" title="Otwórz wpis">
                    &#10140;
                </div>
            `;

            card.addEventListener("click", () => openModal(item));

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
        modalText.textContent = item.description || "Brak dodatkowego opisu.";
        
        if (commentError) commentError.style.display = "none";

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

    function updateModalRatingUI(mediaId) {
        const dbData = supabaseRatings[mediaId];
        const rating = dbData ? dbData.rating : 0;
        const totalVotes = dbData ? dbData.totalVotes : 0;
        const cCount = commentCounts[mediaId] || 0;

        modalStars.innerHTML = generateStarsHTML(rating, mediaId);
        modalRatingNum.textContent = `${rating.toFixed(1)} / 5`;
        modalVotesCount.textContent = `(${totalVotes} głosów | ${cCount} komentarzy)`;

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

        // 1. Walidacja słów obraźliwych
        if (containsProfanity(author) || containsProfanity(text)) {
            commentError.textContent = "Twój nick lub komentarz zawiera zabronione słowa.";
            commentError.style.display = "block";
            return;
        }

        // 2. Walidacja Cloudflare Turnstile
        const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');
        if (!turnstileResponse || !turnstileResponse.value) {
            commentError.textContent = "Proszę ukończyć weryfikację anty-botową Turnstile.";
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

    /* FILTRY I SORTOWANIE */
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
