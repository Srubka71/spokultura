// POBIERANIE DANYCH Z CREW_DATA.JSON I RENDEROWANIE
async function loadCrewData() {
    const crewContainer = document.getElementById("crewGrid");
    if (!crewContainer) return;

    try {
        const response = await fetch("./crew_data.json");
        if (!response.ok) throw new Error("Błąd ładowania danych");
        const data = await response.json();

        crewContainer.innerHTML = ""; // Czyszczenie kontenera

        // SEKCJE DO WYRENDEROWANIA
        const sections = [
            { title: "DJ'S", members: data.djs },
            { title: "B-BOYS (TANCERZE)", members: data.bboys },
            { title: "WRITERZY (GRAFFITI)", members: data.writers }
        ];

        sections.forEach(section => {
            if (section.members && section.members.length > 0) {
                // Tytuł sekcji
                const sectionTitle = document.createElement("h2");
                sectionTitle.className = "crew-section-title";
                sectionTitle.innerText = section.title;
                crewContainer.appendChild(sectionTitle);

                // Siatka dla danej sekcji
                const grid = document.createElement("div");
                grid.className = "crew-grid";

                section.members.forEach(member => {
                    const card = createMemberCard(member);
                    grid.appendChild(card);
                });

                crewContainer.appendChild(grid);
            }
        });

    } catch (error) {
        console.error("Wystąpił błąd:", error);
        crewContainer.innerHTML = `<p style="color: red; text-align: center;">Nie udało się wczytać składu ekipy.</p>`;
    }
}

// FORMATOWANIE KARTY CZŁONKA
function createMemberCard(member) {
    const card = document.createElement("article");
    card.className = "crew-card";

    let socialsHtml = "";
    if (member.socials) {
        if (member.socials.instagram) {
            socialsHtml += `<a href="${member.socials.instagram}" target="_blank" rel="noopener noreferrer" class="crew-social-btn">Instagram &rarr;</a>`;
        }
        if (member.socials.youtube) {
            socialsHtml += `<a href="${member.socials.youtube}" target="_blank" rel="noopener noreferrer" class="crew-social-btn yt">YouTube &rarr;</a>`;
        }
    }

    card.innerHTML = `
        <div class="crew-avatar-wrapper">
            <img src="${member.image}" alt="${member.name}" class="crew-avatar" onerror="this.src='https://via.placeholder.com/300x300/111111/ff6a00?text=${encodeURIComponent(member.name)}'">
        </div>
        <div class="crew-info">
            <div class="crew-role">${member.role}</div>
            <h3 class="crew-name">${member.name}</h3>
            <p class="crew-bio">${member.bio}</p>
            ${socialsHtml ? `<div class="crew-socials">${socialsHtml}</div>` : ''}
        </div>
    `;

    return card;
}

document.addEventListener("DOMContentLoaded", loadCrewData);