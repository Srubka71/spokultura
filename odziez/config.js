/**
 * SPOKULTURA — ODZIEŻ & MERCH
 * Plik konfiguracyjny (config.js)
 */

const CONFIG = {
    // Unikalne ID z serwisu Formspree
    formspreeId: "xaqvkkvo",

    // Ścieżka bazowa dla plików graficznych
    assetsPath: "assets/koszulki/",

    // Lista produktów dostępnych w katalogu zapytań
    products: [
        {
            id: "koszulka-graffiti-czarno-fioletowa",
            name: "Koszulka Graffiti (Czarna / Fioletowy napis)",
            category: "Koszulka (Malfini)",
            price: 90,
            image: "assets/koszulki/black_purple_front.png",
            description: "Wysokiej jakości czarna koszulka uliczna marki Malfini z fioletowym motywem Graffiti Spokultura.",
            hasSizes: true,
            sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
            hasColors: false,
            colors: [],
            backImage: "assets/koszulki/back_black.png"
        },
        {
            id: "koszulka-graffiti-bialo-fioletowa",
            name: "Koszulka Graffiti (Biała / Fioletowy napis)",
            category: "Koszulka (Malfini)",
            price: 90,
            image: "assets/koszulki/white_purple_front.png",
            description: "Wysokiej jakości biała koszulka uliczna marki Malfini z fioletowym motywem Graffiti Spokultura.",
            hasSizes: true,
            sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
            hasColors: false,
            colors: [],
            backImage: "assets/koszulki/white_back.png"
        },
        {
            id: "koszulka-graffiti-bialo-czarna",
            name: "Koszulka Graffiti (Biała / Czarny napis)",
            category: "Koszulka (Malfini)",
            price: 90,
            image: "assets/koszulki/white_black_front.png",
            description: "Wysokiej jakości biała koszulka uliczna marki Malfini z czarnym motywem Graffiti Spokultura.",
            hasSizes: true,
            sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
            hasColors: false,
            colors: [],
            backImage: "assets/koszulki/white_back.png"
        },
        {
            id: "koszulka-one-line",
            name: "Koszulka Spokultura One Line",
            category: "Koszulka (Malfini)",
            price: 85,
            image: "assets/koszulki/black_oneline_front.png",
            description: "Minimalistyczny, nowoczesny design One Line stworzony na bazowej koszulce cenionej marki Malfini. Idealny wybór na co dzień i na eventy.",
            hasSizes: true,
            sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
            hasColors: false,
            colors: [],
            backImage: "assets/koszulki/back_black.png"
        },
        {
            id: "koszulka-original",
            name: "Koszulka Spokultura Original",
            category: "Koszulka (Fruit of the Loom)",
            price: 80,
            image: "assets/koszulki/original_front.png",
            description: "Klasyczny, niezawodny krój na bazie marki Fruit of the Loom z kultowym, oryginalnym logotypem Spokultura.",
            hasSizes: true,
            sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
            hasColors: false,
            colors: [],
            backImage: "assets/koszulki/back_black.png"
        },
        {
            id: "opaska-silikonowa",
            name: "Opaska Silikonowa Spokultura",
            category: "Akcesoria",
            price: 15,
            image: "assets/gadgety/opaska.png",
            images: [
                "assets/gadgety/opaska.png",
                "assets/gadgety/opaska2.png",
                "assets/gadgety/opaska3.png"
            ],
            description: "Czarna, wytrzymała opaska silikonowa o obwodzie 208 mm z przetłoczonym logotypem Spokultura.",
            hasSizes: false,
            sizes: [],
            hasColors: false,
            colors: []
        },
        {
            id: "zestaw-naklejek",
            name: "Zestaw Naklejek Spokultura",
            category: "Gadzety",
            price: 20,
            image: "assets/gadgety/naklejki.png",
            images: [
                "assets/gadgety/naklejki.png"
            ],
            description: "Pakiet mocnych, odpornych na warunki atmosferyczne naklejek winylowych Spokultura. Wybierz swoją ulubioną wersję zestawu.",
            hasSizes: false,
            sizes: [],
            hasColors: true,
            colors: ["Wersja A", "Wersja B", "Mieszane (Wersja A+B)"]
        }
    ]
};