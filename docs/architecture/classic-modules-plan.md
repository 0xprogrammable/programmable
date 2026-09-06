# Programmable Classic Modules – Plan und feste Produktregeln

**Präzisierung zur offenen Architektur:** Die unten dokumentierte Zwei-Effekt-Engine ist der implementierte erste Stand. Der allgemeine zustandsbehaftete Modulablauf wird in [Open Classic module architecture](classic-open-module-contract-v2.md) als nächste Umsetzung spezifiziert. Die bereits ergänzte gemeinsame Launch-Identität ist davon getrennt; sie erweitert die Modulausführung selbst noch nicht.

Stand: 5. September 2026. Ausgangspunkt: `programmablehq/PROGRAMMABLE`, Branch `production`, Commit `ddee606b22af7d0ea92089ce387bdead60b20613`. Dieser Plan beschreibt die neue Generation; bestehende Launches werden nicht umgestellt.

## 1. Das Produkt

Create → Classic startet einen normalen Coin. Advanced ergänzt ausgewählte, geprüfte Module. Der Chat ist später eine optionale Bedienhilfe für denselben Builder und dieselbe API. Er entscheidet weder über Kompatibilität noch über Freigaben.

Der eigentliche langfristige Wert ist ein offener Beitragsstandard: Entwickler oder ihre Agenten erstellen ein Modul, reichen die unveränderliche Version mit Quellcode, Tests, Beschreibung und eigener Reward-Wallet ein, erhalten Review-Feedback und können nach Freigabe an dessen Nutzung verdienen. Ein neuer Launch braucht keine individuelle Plattformfreigabe und keinen Plattform-Launch-Signer.

Der Katalog darf auf 1.000 und mehr Einträge wachsen. Ein einzelner Launch verwendet zunächst höchstens acht unterschiedliche Modulfamilien. Diese Grenze hält Gas, Prüfbarkeit und Laufzeit berechenbar; sie begrenzt nicht den Katalog.

## 2. Was bereits existiert und was neu sein muss

Vorhanden sind deterministische Token-Erstellung, ein einseitiger V4-Pool, ein dauerhaft gesperrter LP-Empfänger, ein atomarer Initial Buy und Prüfungen der tatsächlich angelegten Position. Diese Muster und die fest gebundenen Uniswap-/OpenZeppelin-Abhängigkeiten werden wiederverwendet.

Die vorhandene Classic-Version enthält 10 bps Plattformgebühr innerhalb der ausgewählten Gesamtgebühr. Sie ist an einen Ethereum-Router gebunden. Der Robinhood-Router verlangt ein Plattform-Permit, sein Classic-ABI kennt keine Recipe, und der Robinhood-Feed verarbeitet derzeit ausschließlich Custom. Die neue Gebührenregel und der signerfreie Modul-Launch benötigen deshalb eigene versionierte Contracts und eine eigene deklarierte Indexer-Quelle.

## 3. Die unveränderlichen Geldregeln

- 20 bps entsprechen 0,20 %. Sie fallen auf den nativen Gegenwert jedes Kaufs und Verkaufs an, einschließlich Initial Buy; es gibt keine separate Plattformgebühr für die Erstellung.
- 10 bps sind für Programmable, 10 bps für die Modulautoren vorgesehen. Vom Autorenbetrag erhält jede tatsächlich ausgewählte, freigegebene Modulfamilie genau einen gleichen Anteil. Fünf Module teilen 1.000 Dollar Autorenbetrag in fünfmal 200 Dollar. Derselbe Autor mit zwei unterschiedlichen verwendeten Modulen erhält zwei Anteile.
- Eine Modulfamilie darf pro Launch nur einmal vorkommen; mehrere Versionen desselben Moduls schaffen keine zusätzlichen Anteile. Reine Abhängigkeiten und doppelte Einreichungen werden nicht als zusätzliche verwendete Module bezahlt. Der Review muss künstliches Aufteilen einer Funktion erkennen.
- Creator-Gebühren sind zusätzlich und unabhängig. V1 verwendet begrenzte Buy-/Sell-Einstellungen; 0 % Creator-Gebühr bleibt möglich. Die Oberfläche zeigt dann weiterhin die festen 0,20 % an. Ein Versprechen von insgesamt null Swap-Gebühren wäre falsch. Eine gegebenenfalls aktivierte Uniswap-Protokollgebühr wird separat aus dem Pool gelesen; sie wird von dessen Protokollautorität kontrolliert und gehört nicht zu den verteilten Programmable-Gebühren. Der neue Hook stellt dafür eine aktuelle Komponentenabfrage bereit. Eine Gesamtquote berücksichtigt die unterschiedlichen Gebührenbasen tatsächlich im Swap.
- Creator-Einnahmen können auf bis zu zehn direkte Slots mit unveränderlichen Anteilen aufgeteilt werden. Ein Slot kann auf einen geprüften nativen Gebührenverteiler mit bis zu 1.000 normalen Empfänger-Wallets zeigen. Dessen vollständige, unveränderliche Allokation wird bei der Erstellung geprüft; einzelne Auszahlungen brauchen höchstens zehn Merkle-Schritte. Ein Swap iteriert deshalb nicht über 1.000 Wallets. Modulanteile sind davon getrennt.
- Rundung erfolgt ausschließlich mit Ganzzahlen. Kumulative Verteilung verhindert, dass häufiges Claiming oder Checkpointing zusätzliche Einnahmen erzeugt. Unverteilbare kleinste Einheiten bleiben erkennbarer Rest; sie sind kein versteckter Zusatzanteil.
- Gebühren werden bei ihrer Entstehung der zu diesem Zeitpunkt gültigen Auszahlungsadresse gutgeschrieben. Alte Ansprüche bleiben bei der alten Wallet. Claims sind Pull-Zahlungen und führen beim Swap keinen Aufruf einer Empfänger-Wallet aus.
- Autor-Wallets können nur vom jeweiligen Autor für zukünftige Einnahmen geändert werden. Creator ändern nur ihre eigene aktuelle Slot-Wallet. Reward-Admin oder Treasury können für einen CTO sämtliche zukünftigen Creator-Empfänger atomar austauschen. Der Auftrag bindet eine aktuelle Admin-Revision und Deadline; Creator-Selbstrotationen können ihn nicht blockieren. Eine Bestätigung der bisherigen Empfänger kann alte Admin-Aufträge ungültig machen. Mehrere Slots dürfen auf dieselbe neue Wallet oder einen neuen Verteiler zeigen. Alte Verteiler und alte Ansprüche bleiben erhalten. Niemand verändert dadurch die Hook-Gebührensätze, die Autorenvergütung, Supply, Handel oder bestehende Ansprüche. Bei 0 % Creator-Gebühr hat auch ein neues CTO-Team 0 % Creator-Ertrag.
- Der Empfänger des Autorenanteils bei **null Zusatzmodulen** ist eine ausdrücklich festzulegende Release-Regel; die Implementierung erhält dafür einen unveränderlichen Deployment-Parameter. Die Eigentümerentscheidung wird vor einer Aktivierung gebunden.

## 4. Bonding Curve und Liquidität

Die neue Engine verwendet eine dauerhaft gesperrte, einseitige Position mit einer Milliarde Token und 18 Dezimalstellen. Das ist ein AMM-Preispfad, keine separate Verkaufsphase mit anschließender Migration. Die neue Position reicht vom bisherigen Anfangstick 204200 bis zum untersten für Tickspacing 200 zulässigen V4-Tick −887200. Der alte Classic-Planner bleibt unverändert.

Diese bewusste Korrektur entfernt den viel zu engen bisherigen Endpunkt von ungefähr 18,9-fachem Anfangspreis und 5,9 ETH Netto-Kaufkapazität. Ein echter lokaler Launch mit 8 ETH Initial Buy, weiterem Kauf und anschließendem Verkauf ist geprüft. V4-Preis-/Mengenlimits bleiben bestehen. Bei identischer Supply sinkt die Positionsliquidität im anfänglichen Preisabschnitt gegenüber dem alten engen Bereich um 22,9942 %. Es wäre falsch, größere Preisreichweite als zusätzlich eingezahltes Kapital oder größere Anfangstiefe zu verkaufen.

Käufe bringen Quote-Währung in den Pool, Verkäufe nehmen sie wieder heraus. Das allein bedeutet keine ständig steigende Liquiditätstiefe. Ein späteres Reinvestment-Modul braucht eine festgelegte Einnahmequelle, etwa einen ausdrücklich gewählten Teil der Creator-Einnahmen oder zusätzliches Kapital. Die festen 10 bps Autorenvergütung werden dafür nicht umgewidmet. Ein anderer Kurvenbereich, Stablecoin-Pairing, Aktien- oder Leverage-Mechaniken benötigen passende neue, separat geprüfte Fähigkeiten beziehungsweise eine neue Enginegeneration.

Der Mindest-Initial-Buy wird als unveränderlicher nativer Betrag pro Release gebunden, mit einer aktuellen ungefähren Dollar-Anzeige in der UI. Er ist kein Gaspreis und ohne Kursquelle keine garantierte Dollar-Untergrenze. Der Launch bindet einen positiven Mindest-Token-Output und eine Deadline. Tokenerstellung, LP-Sperre und Kauf gelingen gemeinsam oder werden gemeinsam rückgängig gemacht.

## 5. Die technische Basis

### Registry

`ClassicModuleRegistryV1` speichert freigegebene Modulversionen: stabile Familien-ID, Version, Autor, Fähigkeit, Runtime-Codehash und Digest des vollständigen Review-Manifests. Die Registrygeneration legt das unterstützte V1-Interface fest. Bestehende Versionen können nicht überschrieben werden. Eine Sperre verhindert nur neue Launches mit dieser Version; sie verändert keine existierende Recipe. Die Reviewer-Autorität verwaltet den Katalog, nicht laufende Pools.

### Recipe und Kompatibilität

Eine Recipe bindet Chain, Engine, Basiseinstellungen sowie geordnete Modulversionen und ihre exakten Konfigurationsbytes. Sie wird onchain validiert und gehasht. SDK, API und Builder benutzen dieselbe dokumentierte Kodierung und Cross-Stack-Testvektoren. Der Launch speichert einen Snapshot; ein späteres Katalogupdate ist kein Update des Coins.

V1 erlaubt kleine, klar abgegrenzte Effektarten: eine optionale Creator-Fee-Policy und kombinierbare begrenzte Trade-Limits. Das erste Quote-Limit gilt pro Swap; mehrere Swaps oder Wallets können es umgehen. Es ist kein garantierter Anti-Snipe-Schutz. Module liefern über `staticcall` typisierte Ergebnisse. Sie erhalten keine Poolgelder, keine Tokenfreigaben, kein `delegatecall` in den Hook und keine Berechtigung, Pflichtgebühren zu ändern. Der Kernel prüft Grenzen und kombiniert Effekte deterministisch. Aufrufgas und Rückgabedaten sind begrenzt. Codehash und `staticcall` beweisen allein keine Zustandslosigkeit: unveränderliche, nicht als Proxy arbeitende Provider ohne veränderliche Fremdabhängigkeiten bleiben eine ausdrücklich zu prüfende Zulassungsbedingung.

Eine einzelne Modulfreigabe ist kein Beweis für beliebige Kombinationen. Doppelte Familien, konkurrierende exklusive Effekte, unbekannte Interface-Versionen, unzulässige Parameter und überschrittene Budgets werden abgelehnt. Die Oberfläche zeigt bei einem Konflikt den Grund und passende Alternativen, statt eine bereits ausgewählte Option lautlos verschwinden zu lassen. Neue Effektarten erweitern eine neue Engineversion; bereits gestartete Pools bleiben unverändert.

### Hook und Einnahmen

`ClassicModuleHookV1` ist der einzige Hook des V4-Pools. Er authentifiziert PoolManager und PoolKey, bindet den Poolregistrierer an `token.creator()`, führt die geordnete Recipe aus, setzt Gebühren und prüft vollständige Ausführung. Eine Hook-Registrierung allein macht einen fremden Coin noch nicht zu einem offiziellen Programmable-Launch; dafür ist zusätzlich die manifestgebundene Launcher-Provenienz erforderlich. Alle vier Buy-/Sell- und Exact-Input-/Exact-Output-Fälle werden mit ihren tatsächlichen nativen Deltas geprüft. Uniswap-Claims decken die ausgewiesenen Gebühren vollständig.

Ein zu diesem Hook gehörendes Reward-Ledger trennt Treasury, Autoren und Creator. Es schreibt bereits beim Swap gut und zahlt nur auf ausdrücklichen Claim aus. Dadurch lässt sich eine globale zukünftige Autor-Wallet ändern, ohne alte Erträge nachträglich umzuleiten oder alle bisherigen Launches durchsuchen zu müssen.

### Launch und Provenienz

`ClassicModuleLaunchV1` stellt einen permissionless, walletgebundenen Launch-Einstieg bereit. Er schafft einen neuen, versionierten kanonischen Launch-Datensatz mit Launch-Wallet, Token, PoolManager, Pool-ID, Hook, LP-Empfänger, Recipe-Hash, Modulversionen und Wirtschaftsregeln. Diese neue Quelle muss später ausdrücklich in das Deploymentmanifest aufgenommen werden; ein Event aus irgendeinem Contract genügt nicht.

Der lokale Provenienz-Adapter prüft die Konsistenz der Launch-/Recipe-Evidenz und normalisiert sie als Classic. Er rekonstruiert die Token-Adresse aus der freigegebenen Factory, ihrem Creation-Codehash und den individuellen Launchparametern. Einen gemeinsamen Token-Runtime-Hash gibt es wegen der unveränderlichen Werte pro Token nicht. Der Adapter authentifiziert keine frei eingereichten JSON-Daten: Der produktive Collector muss RPC-/Blockhash-/Runtime-/Finalitätsbelege tatsächlich beschaffen und prüfen, persistente atomare Checkpoints führen und Reorgs behandeln. Profil und Explore verwenden dieselbe verifizierte Token-Identität `chainId:tokenAddress` und die im kanonischen Launch-Datensatz gebundene Launch-Wallet. Drittanbieter sind keine Provenienzquelle.

## 6. So wird Contributing einfach

Das Contributor-Paket enthält Interface, kleines lauffähiges Beispiel, Manifest-Schema, Konfigurationsschema, lokale Validierung, Tests und einen Agentenleitfaden. Ein Entwickler muss kein eigenes Launchpad bauen.

Der Ablauf lautet: Paket erstellen → lokal validieren → unveränderliche Revision einreichen → Review mit nachvollziehbarem Status → gegebenenfalls überarbeitete neue Revision → exakte Version freigeben → Aufnahme in Katalog. Einreichung und Freigabe sind getrennte Rechte. Ein API-Erfolg ist keine Freigabe.

Die API nimmt begrenzte Metadaten und referenzierte, hashgebundene Artefakte an. Sie lädt oder führt eingereichten Code nicht im Webprozess aus. Prüfjobs laufen isoliert. Wallet-Besitz, Größenlimits, Idempotenz, Authentifizierung, Missbrauchsbegrenzung und ein unveränderliches Review-Protokoll gehören zum produktiven Intake. Ein lokales Referenz-Intake kann diesen Zustand abbilden; eine öffentliche API wird erst mit dauerhafter Speicherung und diesen Kontrollen aktiviert.

Für eine Freigabe werden Compiler/Abhängigkeiten, Quellcode-/Runtime-Bindung, Autor-Wallet, wirtschaftliche Wirkung, erlaubte Parameter, Kompatibilität, Worst-Case-Gas, Router-/Quote-Verhalten und Negativ-/Invariantentests geprüft. Module mit veränderlichen fremden Abhängigkeiten, Proxies oder undeklarierten Privilegien erfüllen diesen V1-Standard nicht.

## 7. Umsetzung in prüfbaren Schritten

1. **Fundament:** gemeinsame Typen, versionierte Registry, unveränderliche Recipe, begrenzte Moduleffekte und kanonisches Gebührenledger.
2. **Echter lokaler Launch:** neuer Hook und Launcher mit realem lokalem Uniswap PoolManager/PositionManager; Initial Buy, Buy, Sell, LP-Sperre und Claims.
3. **Contributor-Werkzeuge:** Paket/Schemas, CLI-Validierung, mindestens zwei verschiedene Referenzmodule und maschinenlesbare Konfliktgründe. Keine Pflicht zu KI oder einer bestimmten Entwicklungsumgebung.
4. **Produktanschluss:** Releasebeschreibung, Launch-Encodierung und Provenienz-Normalisierung; Builder/Intake nutzen die gemeinsame Validierung. Die neue Robinhood-Quelle bleibt bis zur tatsächlichen Freigabe deaktiviert.
5. **Verifikation:** Gebührenbasis und Rundung, gleiche Autorenanteile, Wallet-Rotation, fehlende Deckung, Modulefehler, Konflikte, Gasgrenzen, falsche PoolKeys, Initial-Buy-Schutz und atomarer Rollback. Lokale Ergebnisse werden getrennt von externer Prüfung und Onchain-Evidenz dokumentiert.
6. **Freigabe vor öffentlicher Ankündigung:** unabhängige Contract-/Kompositionsprüfung, exakte Deployments und Source-Verifikation, reale Router-/Quote-/Buy-/Sell-/Claim-Nachweise, manifestgebundener finalisierter Indexer und Profil-Roundtrip. Veröffentlichung, Wallet-Signaturen und Geldbewegungen bleiben eigene autorisierte Schritte.

## 8. Erfolgskriterien und Grenzen

Das lokale Fundament ist nachweisbar, wenn ein Contributor-Paket in eine gültige Recipe überführt wird, der echte lokale Launch diese Recipe bindet, ungültige Kombinationen scheitern, nach Swaps die richtigen Wallets vollständig gedeckte Ansprüche besitzen und der normalisierte Launch derselben Creator-Wallet zugeordnet wird.

„1.000 Module im Katalog“, „lokal getestet“, „reviewt“, „deployed“, „finalisiert indexiert“ und „öffentlich benutzbar“ sind unterschiedliche Aussagen. Ein perfekter Contract, der jeden zukünftigen Hook automatisch sicher kombiniert, ist kein seriöses Versprechen. Ein kleiner unveränderlicher Kern mit präzisen Schnittstellen, nachvollziehbarer Freigabe und bewusst versionierten Erweiterungen ist das belastbare Fundament dafür.

Quellen: aktuelle Repository-Dateien `MemeLaunchV4.sol`, `EthCreatorFeeHookV4.sol`, `ClassicPositionPlannerV1.sol`, `ClassicRewardVaultV1.sol`, Robinhood `ProgrammableLaunchStampRouterV1.sol` und `robinhood-finalized-explore-feed-v1.ts`; [Programmable Developer Docs](https://programmable.market/docs/developers), [Uniswap V4 Hooks](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks). Der frühere Hookr-Vergleich bleibt eine Produktreferenz; der Chat ist ausdrücklich optional.
