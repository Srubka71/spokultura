document.addEventListener("DOMContentLoaded", async () => {

    /*
    =====================================================
    SUPABASE CONFIGURATION
    =====================================================
    */
    const SUPABASE_URL = "https://hlruehdtrwfrfagqoyve.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscnVlaGR0cndmcmZhZ3FveXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTE3ODEsImV4cCI6MjA5NDI2Nzc4MX0.W3KbmBFpkAkI7y81HfDzUyUL8n8b85i33qENiXJYLDA";

    let supabaseClient = null;
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }


    /*
    =====================================================
    VISITOR ID (DO GŁOSOWANIA)
    =====================================================
    */
    function getVisitorId() {
        let visitorId = localStorage.getItem("spokultura_visitor_id");
        if (!visitorId) {
            visitorId = "visitor_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
            localStorage.setItem("spokultura_visitor_id", visitorId);
        }
        return visitorId;
    }

    const visitorId = getVisitorId();


    /*
    =====================================================
    DOM ELEMENTS & STATE
    =====================================================
    */
    const mediaGrid = document.getElementById("mediaGrid");
    const emptyState = document.getElementById("emptyState");

    const filterButtons = document.querySelectorAll(".filter-button");
    const sortSelect = document.getElementById("sortSelect");

    let currentFilter = "all";
    let currentSort = "date-desc";

    let supabaseRatings = {};
    let userVotes = {};


    /*
    =====================================================
    FETCH RATINGS & USER VOTES FROM SUPABASE
    =====================================================
    */
    async function loadRatingsFromSupabase() {
        if (!supabaseClient) return;

        try {
            // 1. Pobieranie średniej oraz liczby głosów
            const { data: ratingsData, error: ratingsErr } = await supabaseClient
                .from("media_ratings")
                .select("media_id, average_rating, total_votes");

            if (!ratingsErr && ratingsData) {
                ratingsData.forEach(row => {
                    supabaseRatings[row.media_id] = {
                        rating: Number(row.average_rating),
                        totalVotes: Number(row.total_votes)
                    };
                });
            }

            // 2. Pobieranie głosu obecnego użytkownika
            const { data: votesData, error: votesErr } = await supabaseClient
                .from("media_votes")
                .select("media_id, score")
                .eq("visitor_id", visitorId);

            if (!votesErr && votesData) {
                votesData.forEach(row => {
                    userVotes[row.media_id] = row.score;
                });
            }
        } catch (err) {
            console.error("Błąd połączenia z Supabase:", err);
        }
    }


    /*
    =====================================================
    RATE MEDIA (SEND TO SUPABASE)
    =====================================================
    */
    async function submitRating(mediaId, score) {
        if (!supabaseClient) {
            alert("Brak połączenia z bazą danych.");
            return;
        }

        try {
            const { error } = await supabaseClient
                .from("media_votes")
                .upsert({
                    media_id: mediaId,
                    visitor_id: visitorId,
                    score: score,
                    updated_at: new Date().toISOString()
                }, { onConflict: "media_id, visitor_id" });

            if (error) {
                console.error("Błąd zapisu głosu:", error.message);
                alert("Nie udało się zapisać oceny.");
            } else {
                await loadRatingsFromSupabase();
                renderMedia();
            }
        } catch (err) {
            console.error("Wyjątek podczas oceniania:", err);
        }
    }


    /*
    =====================================================
    RENDER
    =====================================================
    */
    function renderMedia() {

        let items = MEDIA_ITEMS.map(item => {
            const dbData = supabaseRatings[item.id];
            return {
                ...item,
                rating: dbData ? dbData.rating : item.rating,
                totalVotes: dbData ? dbData.totalVotes : 0,
                userScore: userVotes[item.id] || null
            };
        });


        /*
        FILTER
        */
        if (currentFilter !== "all") {
            items = items.filter(
                item => item.type === currentFilter
            );
        }


        /*
        SORT
        */
        switch (currentSort) {

            case "date-desc":
                items.sort((a, b) => new Date(b.date) - new Date(a.date));
                break;

            case "date-asc":
                items.sort((a, b) => new Date(a.date) - new Date(b.date));
                break;

            case "rating-desc":
                items.sort((a, b) => Number(b.rating) - Number(a.rating));
                break;

            case "rating-asc":
                items.sort((a, b) => Number(a.rating) - Number(b.rating));
                break;

        }


        /*
        EMPTY STATE
        */
        if (items.length === 0) {
            mediaGrid.innerHTML = "";
            emptyState.hidden = false;
            return;
        }

        emptyState.hidden = true;
        mediaGrid.innerHTML = "";


        /*
        CREATE CARDS
        */
        items.forEach(item => {

            const card = document.createElement("article");
            card.className = `media-card ${item.type}`;

            /*
            THUMBNAIL & ICON
            */
            const image = item.thumbnail || item.image || "assets/thumbnails/placeholder.jpg";
            const videoIcon = item.type === "video" ? `<div class="video-icon"><span></span></div>` : "";
            const typeLabel = item.type === "video" ? "VIDEO" : "PHOTO";

            /*
            RATING & STARS
            */
            const rating = Number(item.rating || 0);
            const fullStars = Math.floor(rating);
            const hasHalf = rating % 1 >= 0.5;

            let starsHTML = "";
            for (let i = 1; i <= 5; i++) {
                let starChar = "☆";
                if (i <= fullStars || (i === fullStars + 1 && hasHalf)) {
                    starChar = "★";
                }
                starsHTML += `<span class="star-clickable" data-star="${i}">${starChar}</span>`;
            }

            const formattedDate = formatDate(item.date);

            const userScoreText = item.userScore 
                ? `Twój głos: <strong class="user-score-highlight">${item.userScore} ★</strong>` 
                : `Twój głos: <span class="user-score-none">brak</span>`;

            /*
            CARD HTML
            */
            card.innerHTML = `

                <div class="media-card-image">
                    <img src="${image}" alt="${escapeHTML(item.title)}" loading="lazy">
                    ${videoIcon}
                    <span class="media-type">${typeLabel}</span>
                </div>

                <div class="media-card-content">

                    <div class="media-card-top">
                        <div>
                            <h2>${escapeHTML(item.title)}</h2>
                            <h3>${escapeHTML(item.subtitle || "")}</h3>
                        </div>
                        <time datetime="${item.date}">${formattedDate}</time>
                    </div>

                    <p class="media-description">
                        ${escapeHTML(item.description || "")}
                    </p>

                    <div class="media-card-bottom">

                        <div class="rating-box">
                            <div class="stars-row">
                                <span class="stars" title="Kliknij gwiazdkę, aby oddać swój głos">
                                    ${starsHTML}
                                </span>
                                <span class="rating-number" title="Średnia ocena">
                                    ${rating.toFixed(1)} / 5
                                </span>
                            </div>

                            <div class="rating-info">
                                <span class="votes-count">${item.totalVotes} ${item.totalVotes === 1 ? "głos" : "głosów"}</span>
                                <span class="bullet">•</span>
                                <span class="user-vote-status">${userScoreText}</span>
                            </div>
                        </div>

                        <button class="open-media" type="button">
                            ${item.type === "video" ? "OTWÓRZ FILM" : "POKAŻ ZDJĘCIE"}
                        </button>

                    </div>

                </div>
            `;

            /*
            CLICK - OPEN MEDIA
            */
            card.querySelector(".open-media").addEventListener("click", () => openMedia(item));

            /*
            CLICK - RATE (STARS)
            */
            card.querySelectorAll(".star-clickable").forEach(starEl => {
                starEl.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const selectedScore = Number(starEl.dataset.star);
                    submitRating(item.id, selectedScore);
                });
            });

            mediaGrid.appendChild(card);
        });

    }


    /*
    =====================================================
    OPEN MEDIA
    =====================================================
    */
    function openMedia(item) {
        if (item.type === "video") {
            if (!item.videoUrl) return;
            window.open(item.videoUrl, "_blank", "noopener,noreferrer");
            return;
        }

        if (item.image) {
            window.open(item.image, "_blank", "noopener,noreferrer");
        }
    }


    /*
    =====================================================
    FILTER BUTTONS
    =====================================================
    */
    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            filterButtons.forEach(btn => btn.classList.remove("active"));
            button.classList.add("active");
            currentFilter = button.dataset.filter;
            renderMedia();
        });
    });


    /*
    =====================================================
    SORT
    =====================================================
    */
    sortSelect.addEventListener("change", event => {
        currentSort = event.target.value;
        renderMedia();
    });


    /*
    =====================================================
    DATE FORMAT
    =====================================================
    */
    function formatDate(date) {
        if (!date) return "";
        const parsed = new Date(date);
        if (Number.isNaN(parsed.getTime())) return date;
        return new Intl.DateTimeFormat("pl-PL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(parsed);
    }


    /*
    =====================================================
    HTML ESCAPE
    =====================================================
    */
    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&#039;");
    }


    /*
    =====================================================
    INITIAL RENDER
    =====================================================
    */
    await loadRatingsFromSupabase();
    renderMedia();

});
