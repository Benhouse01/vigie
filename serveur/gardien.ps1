# LE GARDIEN DE VIGIE. Toutes les deux minutes, il verifie que le moteur est vivant,
# que le disque tient, et que le journal de la base ne devore pas la machine.
#
# ⛔ IL NE REGARDE PAS L ETAT DE LA TACHE PLANIFIEE, IL REGARDE LE PROCESSUS.
#    Le 21/08/2026, VigieRobotLarge affichait « Ready » et « Last Result: 0 » : du point
#    de vue du planificateur tout s etait bien passe, le robot etait simplement mort, et
#    il l est reste 43 heures. Une tache qui dit « Running » peut aussi survivre a son
#    propre processus. Seule la ligne de commande de node dit la verite.
$journal = 'C:\vigie\gardien.log'
$dire = { param($m) "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m | Add-Content $journal }

# ⛔ LE FREIN DU DISQUE PASSE AVANT TOUT LE RESTE.
#    Un disque plein n arrete pas proprement SQLite, il le corrompt. Sous quatre
#    gigaoctets libres on COUCHE les deux robots, exprès, et on le dit. Le pousseur et
#    le rapporteur restent debout : ils vident vers Cloudflare, ils n ecrivent presque rien.
$libre = [math]::Round((Get-PSDrive C).Free / 1GB, 2)
if ($libre -lt 4) {
  & $dire "FREIN DISQUE : $libre Go libres. Les deux robots sont couches. Faire de la place, puis schtasks /run /tn VigieRobotNiche et VigieRobotLarge"
  & schtasks /end /tn VigieRobotNiche 2>&1 | Out-Null
  & schtasks /end /tn VigieRobotLarge 2>&1 | Out-Null
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*crawler.mjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  exit 0
}
if ($libre -lt 8) { & $dire "disque : $libre Go libres, le frein tombe a 4" }

# Les quatre processus du moteur, et la tache qui les remet debout.
# DECISION DE BENJAMIN, 23/08/2026 : LES DEUX ROBOTS DE CRAWL SONT ARRETES.
#    Motif de fond, pas incident : un index general du web ne tient pas sur ce disque.
#    Mesure du jour a pleine cadence, 15 Go par jour pour 62 500 liens la minute, dont
#    la quasi-totalite ne vise aucun domaine suivi (arxiv.org : 68 287 liens notes,
#    ZERO vers une cible). Le stockage se paie, et personne ne rattrape un robot qui
#    lit 7,5 milliards de pages par jour. Ce que Vigie garde ne se crawle pas : Bing
#    Webmaster pour les domaines referents des concurrents, Search Console pour le reel
#    sur nos domaines, le graphe Common Crawl deja pose sur ce serveur, et la lecture
#    du rel sur les liens deja connus.
#    ⛔ LES DEUX ROBOTS NE SONT DONC PLUS DANS CETTE LISTE. Les y remettre les relance
#       dans les deux minutes, et le disque repart a 15 Go par jour.
$attendus = @(
  @{ motif = '*pousser-liens*';    tache = 'VigiePousseur';    nom = 'pousseur'     },
  @{ motif = '*rapporter.mjs*';    tache = 'VigieRapporteur';  nom = 'rapporteur'   }
).Free / 1GB, 2)
if ($libre -lt 4) {
  & $dire "FREIN DISQUE : $libre Go libres. Les deux robots sont couches. Faire de la place, puis schtasks /run /tn VigieRobotNiche et VigieRobotLarge"
  & schtasks /end /tn VigieRobotNiche 2>&1 | Out-Null
  & schtasks /end /tn VigieRobotLarge 2>&1 | Out-Null
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*crawler.mjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  exit 0
}
if ($libre -lt 8) { & $dire "disque : $libre Go libres, le frein tombe a 4" }

# Les quatre processus du moteur, et la tache qui les remet debout.
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
#    Cent vingt lecteurs ne laissent jamais ce trou, alors le journal s allonge sans
#    fin : mesure du 23/08/2026, un gigaoctet de journal en trois minutes pour 28 Mo de
#    donnee reelle, trente-six fois la donnee. On pose donc le fichier PAUSE, les
#    lecteurs se rangent en quelques secondes, on vide, on retire le fichier. Aucune
#    page perdue : l etat vit en base, pas dans le robot.
#
# ⛔ ET ON REESSAIE, PARCE QUE LES ROBOTS NE SONT PAS LES SEULS A LIRE.
#    Le pousseur et le rapporteur ouvrent la meme base et n obeissent pas au fichier
#    PAUSE : ils passent, ils tiennent une transaction quelques secondes, et le vidage
#    tombe pile dedans. Premiere tentative reelle du gardien, 23/08/2026 18h26 :
#    « VIDAGE EMPECHE, un lecteur tenait encore », journal inchange a 1 660 Mo. Un seul
#    essai ne suffit donc pas ; cinq essais espaces de huit secondes couvrent leur passe.
$wal = 'C:\vigie\donnees\index.sqlite-wal'
$walGo = if (Test-Path $wal) { [math]::Round((Get-Item $wal).Length / 1GB, 2) } else { 0 }
if ($walGo -gt 1.2) {
  & $dire "journal WAL a $walGo Go : mise en pause des lecteurs le temps de le vider"
  New-Item -ItemType File -Path 'C:\vigie\PAUSE' -Force | Out-Null
  Start-Sleep -Seconds 12
  $vide = $false
  foreach ($essai in 1..5) {
    $sortie = & 'C:\Program Files\nodejs\node.exe' 'C:\vigie\serveur\checkpoint.mjs' 2>&1
    $ligne = ($sortie | Where-Object { $_ -match '^journal :' }) -join ' '
    if ($LASTEXITCODE -eq 0) { & $dire "vidage du journal (essai $essai) : $ligne"; $vide = $true; break }
    # Le fichier PAUSE se perime au bout de dix minutes cote robot : on le retouche
    # a chaque essai pour qu il reste valide pendant toute la serie.
    (Get-Item 'C:\vigie\PAUSE').LastWriteTime = Get-Date
    Start-Sleep -Seconds 8
  }
  if (-not $vide) { & $dire "vidage du journal IMPOSSIBLE apres cinq essais, un lecteur ne lache pas : $ligne" }
  Remove-Item 'C:\vigie\PAUSE' -Force -ErrorAction SilentlyContinue
}
