# LE GARDIEN DE VIGIE. Toutes les deux minutes, il verifie que le service est vivant,
# que le disque tient, et que le journal de la base ne devore pas la machine.
#
# ⛔ CE SERVEUR EST CELUI DE LA PRODUCTION TRADOSHI, PAS UN BANC D ESSAI.
#    TradoshiMT5Daemon et TradoshiSupportInbox y tournent. Ce qui remplit ce disque
#    n arrete pas Vigie, il arrete les connexions courtiers des utilisateurs.
#
# ⛔ IL NE REGARDE PAS L ETAT DE LA TACHE PLANIFIEE, IL REGARDE LE PROCESSUS.
#    Le 21/08/2026, VigieRobotLarge affichait « Ready » et « Last Result: 0 » : du point
#    de vue du planificateur tout s etait bien passe, le robot etait simplement mort, et
#    il l est reste 43 heures. Une tache qui dit « Running » peut aussi survivre a son
#    propre processus. Seule la ligne de commande de node dit la verite.
$journal = 'C:\vigie\gardien.log'
$dire = { param($m) "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m | Add-Content $journal }

# ⛔ LE FREIN DU DISQUE PASSE AVANT TOUT LE RESTE.
#    Un disque plein n arrete pas proprement SQLite, il le corrompt, et ici il emporte
#    le demon MT5 avec lui. Sous quatre gigaoctets libres, on le dit et on coupe tout ce
#    qui ecrit gros.
$libre = [math]::Round((Get-PSDrive C).Free / 1GB, 2)
if ($libre -lt 4) {
  & $dire "FREIN DISQUE : $libre Go libres sur le serveur de production Tradoshi. Faire de la place."
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*crawler.mjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  exit 0
}
if ($libre -lt 8) { & $dire "disque : $libre Go libres, le frein tombe a 4" }

# DECISION DE BENJAMIN, 23/08/2026 : LES DEUX ROBOTS DE CRAWL SONT ARRETES.
#    Motif de fond, pas incident : un index general du web ne tient pas sur ce disque.
#    Mesure du jour, 15 Go par jour, dont la quasi-totalite ne vise aucun domaine suivi
#    (arxiv.org : 68 287 liens notes, ZERO vers une cible). Et le tarif condamne l idee :
#    514 octets par lien url vers url, contre 23 Mo pour le meme graphe en domaine vers
#    domaine, facteur 330. Ce que Vigie garde ne se crawle pas : Bing Webmaster pour les
#    domaines referents des concurrents, Search Console pour le reel sur nos domaines, le
#    graphe Common Crawl deja pose ici, et la lecture du rel sur les liens connus.
# ⛔ LES DEUX ROBOTS NE SONT DONC PLUS DANS CETTE LISTE, et leurs taches sont desactivees.
#    Les y remettre les relance dans les deux minutes, et le disque repart a 15 Go/jour.
$attendus = @(
  @{ motif = '*pousser-liens*';   tache = 'VigiePousseur';   nom = 'pousseur'   },
  @{ motif = '*rapporter.mjs*';   tache = 'VigieRapporteur'; nom = 'rapporteur' }
)
$procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)
foreach ($a in $attendus) {
  $vivant = $procs | Where-Object { $_.CommandLine -like $a.motif }
  if (-not $vivant) {
    & $dire ("{0} ABSENT, relance de la tache {1}" -f $a.nom, $a.tache)
    # Une tache restee « Running » sans processus refuse de repartir : on la termine d abord.
    & schtasks /end /tn $a.tache 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    & schtasks /run /tn $a.tache 2>&1 | Out-Null
  }
}

# ⛔ LE JOURNAL WAL NE SE VIDE QUE QUAND PLUS PERSONNE NE LIT.
#    Mesure du 23/08/2026 : un gigaoctet de journal en trois minutes pour 28 Mo de donnee
#    reelle, trente-six fois la donnee, parce qu une page reecrite cent fois occupe cent
#    places tant que le fichier n est pas remis a zero. On pose le fichier PAUSE, les
#    lecteurs finissent leur page et se rangent, on vide, on retire le fichier. Aucune
#    page perdue : l etat vit en base, pas dans le robot.
# ⛔ ET ON REESSAIE, PARCE QUE LES ROBOTS NE SONT PAS LES SEULS A LIRE. Le pousseur et le
#    rapporteur ouvrent la meme base et n obeissent pas au fichier PAUSE. Premiere
#    tentative reelle, 18h26 : « VIDAGE EMPECHE », journal inchange a 1 660 Mo. Cinq
#    essais espaces de huit secondes couvrent leur passe.
$wal = 'C:\vigie\donnees\index.sqlite-wal'
$walGo = if (Test-Path $wal) { [math]::Round((Get-Item $wal).Length / 1GB, 2) } else { 0 }
if ($walGo -gt 1.2) {
  & $dire "journal WAL a $walGo Go : mise en pause des lecteurs le temps de le vider"
  New-Item -ItemType File -Path 'C:\vigie\PAUSE' -Force | Out-Null
  Start-Sleep -Seconds 12
  $vide = $false
  $ligne = ''
  foreach ($essai in 1..5) {
    $sortie = & 'C:\Program Files\nodejs\node.exe' 'C:\vigie\serveur\checkpoint.mjs' 2>&1
    $ligne = ($sortie | Where-Object { $_ -match '^journal :' }) -join ' '
    if ($LASTEXITCODE -eq 0) { & $dire "vidage du journal (essai $essai) : $ligne"; $vide = $true; break }
    # Le fichier PAUSE se perime au bout de dix minutes cote robot : on le retouche a
    # chaque essai pour qu il reste valide pendant toute la serie.
    (Get-Item 'C:\vigie\PAUSE').LastWriteTime = Get-Date
    Start-Sleep -Seconds 8
  }
  if (-not $vide) { & $dire "vidage du journal IMPOSSIBLE apres cinq essais : $ligne" }
  Remove-Item 'C:\vigie\PAUSE' -Force -ErrorAction SilentlyContinue
}
