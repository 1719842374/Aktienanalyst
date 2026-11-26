import { DE_NOUN_LEMMAS } from "./de-nouns";

/** Short names of notable companies, from German or multilingual labels.
 * Source: Wikidata main namespace, instance of business (Q4830453) or public company (Q891723), at least five sitelinks.
 * A legal suffix (SE, AG, KGaA, GmbH, plc, Group, Inc, NV, SA) is stripped. Words from the podcast lexicon are left out.
 * License: CC0. https://www.wikidata.org/wiki/Wikidata:Copyright
 * "All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under the Creative Commons CC0 License."
 */
export const DE_COMPANY_NAMES: string[] = `
aaeon aaton aavin abanca abarth abbvie abcam abebooks abena abengoa aberdeen abertis abiomed abit
ableton absa academi acast acceleron accenture acciona acco accton accuphase accurist acea acer
aceralia acergy achmea acorn acronis actavis actel actelion action acxiom adama adani adaptec
adapteva adata addtech addthis adecco adevinta adidas adient adio adler adlib adlibris admiral adobe
adox adscape adtran advantech advantest adweek adyen aebi aecom aegon aeon aercap aerodium aeroflot
aerostar aerovironment aetna affirm affymetrix aflac afriquia afry agco agerpres agfa aggreko
agilent agora agrium agrofert agrokomerc ahlstrom aiesec aiful aigan aimco aimpoint aion aiptek
airasia airbnb airbus airgas airhelp airtable aixtron ajegroup ajinomoto akai akamai akbank akismet
akqa akris akron akropolis aksa akubra akzonobel alan albani albatron albertsons albpetrol
albtelecom alcatel alclad alcoa alcon aldebaran aldec alden alesis alessi alexbank alfa alias
aliaxis alibaba alienware aliexpress alinco allegion allergan alliancebernstein allianz allsaints
allstate alltel almarai alnatura alpargatas alphapolis alpina alpinestars alpla alro alrosa alsea
alstom altadis altana alten altera alteryx altia alticor altiris altova altri altria alumina alweg
amada amaggi aman amazon ambev ambu amcor ameren americana americanas amerisourcebergen amersham
ametek amgen amigo amlogic ammann amorepacific ampeg amphenol amplifon amprion amrest amstrad amundi
amuse amyris anandtech anas anasagasti andeavor andritz animoca aniventure anivision ankai anker
anritsu ansaldobreda ansco ansell ansys antarchile antec antei antenna anthropic antofagasta antolin
anttila aopen apple aperam apetito apollinaris apollo apotex aptiv aqababahn aquafon aquaplus arabia
arabsat aracruz aral araltuz aramark arbed arburg arcadia arcadis arcandor arcelormittal
archaeopress arctia arctic ardagh arena arenanet argenx argo argos aria aricent arika ariston
arktikugol arktos arminco armscor arnold arola aroundtown arrinera arris arriva arrival arsat artega
artmajeur artumas arturia artx arup arvesta aryzta asahi asarco asbis aschehoug ascii ascom aselsan
asetek asfinag ashampoo ashtead asiacell asiasat asics asix askam asml asot asprey asseco assurant
astaldi astellas astralis astrazeneca astro asus atala atebank athearn atlassian atlet atmel
atomenergoprom atomredmetzoloto atomstroiexport atos atotech atradius atresmedia atria attachmate
audax audi audible audimas auhagen aurubis aussiebum austal autech auticon autobianchi autodesk
autodoc autogrill autoliv automattic autonation autonavi autoneum autozone avaloq avanza avatrade
avaya avea avebe aveda aventics aveva avex avia aviajet aviapartner aviatik avid aviko avinor avira
avirex avision aviva avlo avnet avocent avolta avro avtoframos awardwallet awiakor awtowas awtowelo
axact axfood axiata axios azercell azermarka azimut azrieli azsamand azul baan babyliss bacardi
backblaze badoo baglietto baidu bajaj bakkafrost bakkavör baladna balchaschzwetmet balda baloise
baltika baltona bamix bancolombia bancorex banelco banesco baneservice banesto bankboston bankia
bankinter bankmuscat banknordik banorte banpu banrisul baosteel barbour barclays barco barilla
baschneft basecamp basf basso bata batelco bauerfeind bauhaus bauknecht baumax bavaria bayer baygon
baykar bayliner baywa bburago bcci bealls beamdog beams bearingpoint beatport beaulieu bechtel
bechtle beddit befimmo beher behringer beiersdorf beijnes beka bekaert beko belapan belaruskali
belden belfor belga belgospischeprom belinea belkommunmasch bellasi bellsouth bellway belneftekhim
belo belomo belpost belron belshina belships belsize belstaff belvision bembos beml bench bene
benelli benetton benq bentley bereal berendsen berentzen bergsala berijew berjoska bernafon
bernmobil bershka bertazzoni bestseller bestune bestway betclic betfair betfred betsson betv beurer
bezeq bfgoodrich bharatbenz bial biamax bianchi biba bidvest biffa bigbank bilfinger bilibili billa
billabong billerudkorsnäs binatone bing binggrae biocon bioderma biogen bionade biontech biostar
biotherm biotika bird birkenstock bisazza bitdefender bitfinex bitly bittorrent bitvavo bitzer
bizagi bizerba bizon blackberry blacklane blackrock blackstone blancpain blaupunkt blimpie bluebird
bluehost bluestacks blum bmobile bnito bobst boconcept bodum boeing bofors bofrost boliden bolwell
bomag bombardier bomis bonava bonnier bonprix boohoo borden borders borealis borges borgward
borgwarner borouge borsalino borsig borsodchem boryszew boskalis bosnalijek boss bossini bouwfonds
bouygues bovril brabantia bradesco bradespar brainlab bramac branobel brasinca braskem braugold
braun brawa breadtalk bredamenarinibus bregentved breitling brembo brennerautobahn brenntag breville
bridgestone brigada brill bring brioni britvic broadbandtv broadcom brobizz brocade broderbund
brugal brugseni bruker btcc bticino bubba buchla budd buenaventura bufori buick bukh bulgaralpine
bulgarrenault bullworker bulsatcom bulthaup bumble bundesdruckerei bunzl burberry burgeranch
burgundy burlington burson bushiroad busicom butlins buzzfeed bwxt bybit byggmax bytedance byton
böhmerland böker bührer bürkert büssing cablevision caci cactus cadence cainiao caixabank cakewalk
caldera caleres calico calida calpis calzedonia cameco camelbak cameo camerica campagnolo camper
camus candy canfor canica cannondale canon capco capio capita capitaland capitalia carbfix caresto
carfax cargill carglass cargolifter cargotec carillion carlsberg carlyle carmax carmeuse carmignac
carnet carrier carulla carvana carvel cascades casio casper castore castrol casumo catalent
caterpillar cateye cavium cazoo cbre ceat cecosesola cecotec cegedel celanese celcom celera
celestica celestron celgene cellebrite celltrion celsa cemex cemig cencosud centamin centene
centertelekom centocor centra central centrica centuri ceratizit ceres ceridian cerruti cevital cewe
cfmoto chagee chaintech changhe changhong chantelle chaosium chargepoint chedraui chegg cheminova
chemours chemtura chep cherry chicco chimprom chinabank chinon chipolbrok chisso chkmb chloride
chobani chronoswiss chubb ciba ciena cigna ciklum cimatron cimb cimic cimier cimos cimpor cineflix
cinelli cinemark cinemaxx cineworld cintas cintra cinven cipla circle circleci cirio cirquent cisco
cision cisitalia citect citgo citibank citigroup citrosuco citterio citycon citymapper citynightline
civita claas claeys clairol claranet clariant clarion claris clarivate clarizen clarks clavia
clearstream clevo clickteam clock cloetta clorox cloudera cloudflare cnbm cnova coach coamix coats
cobham coby codecademy codegear codelco codeweavers coemac cofco coffeehouse cofinimmo cogeco cognex
cognos coillte coinbase coleco coleman colian collabnet collabora collider colnago coloplast colruyt
comarch comau comcast comerica comicsone commer commerzbank compal compaq compass complex comptia
compusa compuserve computershare computervision compuware comscore conad conair concentrix conergy
conexant connectix conocophillips consolis constructa contax continental convatec convergys
converium converse cook coolblue cooliris coolpad coop coopervision copart copel copersucar coppelia
corecivic corecom corel coremedia coreweave corficolombiana corning correios corteva corum corus
cosan cosina costamare costar costco costcutter cotral coty couchsurfing coupang cournil coursera
courtaulds courvoisier covance coventya covergirl covestro covra cowi cowon crackle crai cray
crayola credicorp creditanstalt creditreform criteo crocs crombie cromemco crossfit crossgen crotram
crowdstrike crrc crumpler crunchbase crypto csepel cubatabaco cube cuisinart culligan cupra curevac
cushman cutrale cyberagent cyberark cyberdreams cybereason cyberghost cyberlink cyclacel cycleurope
cygames cyma cyrix cyta czechoslovak dacia daewoo dafabet dahon daicel daihatsu dailymotion daimaru
daimlerchrysler dainese dakine daks daktronics dalsa dangote danieli danisco dart dartz dasa
databricks datadog datapoint datastax datel dayun dazn dearcc debenhams debswana dedeman deep
deepcool defa degtjarjowwerk degussa dehomag delcam delek delhaize deliveroo dell delticom demag
dematic dena denel denizbank denon denso deoleo depositphotos dermapharm descente desfa despegar
destia devolo devsisters dewind dexcom dfds dhiraagu diadora diageo dialog diana diasorin dicos didi
dieffenbacher diesel diggerland digi digicert digicube digidesign digikala digimind diginotar
digitalbridge digitalglobe digitalocean digitech digiturk digium dimarzio diodes directv discovery
disneynature diversey dixy djarum dkny dmarket dmart dniproenergo doble dobro dockwise docusign
dodge dodgeball doepfer dofasco dolby dole dollarama dolmar dome dometic domtar donecle donic
donotpay donuts doodle doogee doordash dormakaba douban doubleclick doubletwist douglas draftkings
drax draytek dreams dremel dressmann drivenow drägerwerk drögmöller dstv dtac dual dualit dualstar
duferco dulux dunnes dupont duracell duralex duravit durex durst duslo dussmann dustbot dustin
dymocks dynapac dynatrace dynaudio dynegy dynetics dynit dyrehavsbakken dysan dyson dürr earthlink
eastpak easygroup eataly eazel ebara ebauches ebel ebusco ecco echostar ecolab economia ecopetrol
ecorodovias ecover ectaco edel edelman edenred edge edgio edifier edipresse edmodo edox edran
edrington efacec effoa egmont ehang eheim eidosmedia eimskip eircom eisai eitb eizo ekornes elan
elanco elecnor elecraft electrica electroplanet elekta elementis elering eles elevenlabs elia
eliminalia elin elisa elkar ellesse ellos elopak elpozo emagic embracer embraer embratel emerdata
emergent emmi empik enaer enana enasa enav enbridge enbw encana encrochat endeavor endemol endesa
endiama enea eneco enefit enel eneos energa energean energinet energoinvest energopetrol engesa
eniro enmtp enoc enron ensco ensoniq enstrom entain entegris entercom entergy enterprisedb entrust
envato eotech epcos epicor epik epiphone epiroc epox eppendorf epson epyx equifax equinix equinor
erdemir ergis ericsson eridania erima erke ernemann erno erste esab escada esci escobar escorts
esemka eset esko eskom eslite esna essar essel esselte essilorluxottica essity estes estline esto
estrella eterna etisalat etro etsy etzelwerk eucerin eulengebirgsbahn eumig eunet eurasia eurobank
eurocash eurofighter eurofima euronext euronics europabio europcar eurospin eurosport eurowag
euroway eushully euskaltel eutelsat everbank evergrande everipedia everlast everydns evga eviny
evoke evolve evraz exact exelixis exelon exide exidy exor expedia experian expert express expressbus
exxaro exxon exxonmobil fabbri fablok facc faceit facel facit factiva faema fage fagor fahrlader
fairline falabella falck falconbridge falke familymart familytreedna fandango fantagio fanuc
fareastone fareva farfetch farmfoods fastenal fastjet fastly fastmail fastned fastweb faur fazer
fazioli feastables febo fedex fedrigoni feldschlösschen fellowes fender fendi fenwick fernseh ferodo
ferrari ferratum ferrellgas ferrexpo ferring ferrovial fertiberia festo festool fiamm fiat fibria
fico fielmann fiio fila filofax fincantieri findev findus finecobank finnair finnvera finta firebase
fireeye firmenich firstenergy firstgroup firstrand fischerwerke fiserv fiskars fisker fisons fissler
fitbit fitshop fives fjällräven flattr flaxwood fleischmann fleishmanhillard flexera flexform
flightaware flipkart flix flowserve flsmidth fluke fluor fluxys flybe flyeralarm flygbussarna flynas
focus fodera folgers folksam foma foodora forcepoint ford formlabs fornasari forte fortebank
fortinet fortive fortum fosagro fossil fostex fosun fotolia foveon foxconn foxtron franceinfo
franklincovey fraport frasers frateschi freecom freenet freitag fresenius fresnillo friden
frigidaire fritos froneri frontline frosta frutarom ftdi ftse fubotv fubu fujifilm fujikoshi fujitsu
fullbright funko furla furyu future futuremark fxpro fällkniven gaikai gail gainward gakken galderma
galenica galenika gallaher galp gama gambro gamepark gamerant gamestop gammarelli gamtek gandi
gannett gant ganten gardaworld gardein garden gardena garena garrigues gasgrid gassco gasum gateway
gatorade gatx gaulhofer gazprom gazprombank geberit gecas geely geico geldermann gelita gelsenwasser
gemballa gemini genelec genentech generalmusic genesi genesys geni genmab genpact gensler gentex
genting genus genzyme geoeye geopost geosentric geotrust geox gericom gerresheimer getir getlink
getronics gett getyourguide giant gigadevice gigaset gilbern ginsters gionee gios giovanola girobank
girteka givaudan gjensidige glanbia glassdoor glencore glitnir globalfoundries globallogic
globalsign globalwafers globomedia globosat glory gmarket gmobile godaddy godrej goertek gogoro gola
goldbeck goldcorp goldhofer goldoni goldstar goldwind golla gomspace goodman google goophone gopro
gorenje goto grab gracenote graco graetz graflex graftgold granada granarolo graphisoft greencore
greenland greenwheels greenyard greggs greif grenke grezzo grifols grimaldi gritzner grohe grolsch
grontmij groupama groupon grubhub gruma grundfos grundig gruner grusonwerk grünenthal gtbank gtech
gucci guerciotti guess guild guinness gumstix gustavsberg guyatone gyldendal gymbeam gymboree
gymshark güleryüz gützold habermaass hachette hackman haemonetics hafslund hagemeyer hager haglöfs
hagström haidilao haier hakusensha halcrow haldex haleon halfords halifax halla halliburton
hallicrafters hallmark halma hama hameg hamm hammerson hamster hancom handelsbanken handspring
hanergy hanes hanesbrands hansaworld hansgrohe hanteng hanwag hanwha hapag happn harsco harting
hartwall hasbro hasee hashicorp hatena haval havelsan hayden hazet hbos head headhunter heartbeat
heidenhain heijmans heimstaden heineken heinemann helijet heliswiss helitrans heljan helkema hella
hellermanntyton hellofresh hemofarm hempel hengli henkel hennessy hensoldt hepco hera heraeus
herbalife hermle hero heroku herpa herrenknecht hershey herstal hertz hess hettich hetzner hgst hhla
hidroelectrica hifiman hightail hikvision hilleberg hilti hipra hiscox hisdesat hisense hispasat
hitachi hite hiwin hkscan hochland hochtief hoechst hola hollyfrontier hologic homebase homeserve
honda honeywell hongqi honor hoover horiba hormel hornady hornbach horten hortex hortonworks hosiden
hospira hostgator hostway hotusa hoverspeed hsbc huawei huazhu hublot hubspot huel huhtamäki hulu
humana humax humber humbrol huobi hupmobile husqvarna huyghe hyatt hydrema hydroprojekt hyimpulse
hymer hyosung hytera hyundai hästens höfner hürlimann iamgold ibanez ibercaja iberdrola iberduero
ibiden iceland icelandair icesave icewarp ichijinsha icom igalia iglo ignitis iittala ikano ikarus
ilfc ilkka illumina illy ilpap imagemovers imageshack imaginarium imagineer imbel imec imgur imperva
implats implenia impresa imtech inax inchcape incyte indeed inditex indofood indosat indovision
industrivärden ineos inficon infineon infobip infocom infocus infomaniak infopark informa
informatica infostrada infowars infranord infratil ingles inglot ingredion inktomi inmarsat inmos
innocent innocenti innocentive innogames innogy innowise inokom inpex inspur instacart instinet
integral intel intelsat interactivecorp intercell intergraph interislander interleaf intermec
interoute interparking interpump interros intershop intersil intersnack intersystems intertek
interwetten interxion intimissimi intouch intracom intratec intrum intuit invacare invap inventec
invesco investcorp investor invicta invista invitrogen inwi ionity ionos ipko iqvia irdeto iren
iridium iriver irizar irkut irkutskenergo irma ironfx ironport irshad isavia ischmasch isdb isdera
isover ispace isuzu itala italgas italika iveco ixopay ixys iyuno izod izotope jabra jacuzzi
jadrolinija jaiku jajah jako jamba jamnica jamo janes jansen jansport jazztel jboss jdsu jebsen jeep
jelcz jenapharm jenoptik jeol jerini jetbrains jetco jinchuan jinkosolar jmicron jofa johnson joker
joma jooble joola jouef jowood joyent jtekt juddmonte juicero juki jula jumbo jumia jumo junghans
jungheinrich junttan juschmasch justia juul jysk kabam kabukiza kadokawa kaggle kahoot kaipan
kaleida kaltura kalyon kamaka kaman kamaz kamow kangol kantanka kantar kapla kappa kappahl kapsch
kardemir kardex karhu karmann karosa karrier karsan kartell kato kaufland kavim kawai kawasaki
kaweco kayaba kayak kazakhgold kazakhmys kazakhtelecom kazatomprom kazmunaygas kaztransoil kazzinc
kcell kddi kearney keds kegoc keifuku keimfarben kelda kellanova kelvinator kema kemira kempinski
kemppi kenda kenko kennametal kenvelo kenzo kering kerry kesko keybank keybase keyeast keyence kibon
kidde kidzania kier kiewit kika kikkoman king kingfisher kingsoft kingspan kinnevik kioti kioxia
kipling kirowwerk kiwibank kkcg klabin klipsch klout kmart kmgi knds kneissl knipex knoll knorr
kochlöffel kodak kofax koga komori komplett konami kone konecranes konica konka konstal konsum
kontron konzum koppers kores korian koryolink kosmino koziol kramer kraz kret kriworoschstal krka
kroger kronan krones kronospan kross kruidvat krupp ktel kubota kudelski kuka kumon kungfu kuoni
kureha kurganmaschsawod kusnezow kuwahara kverneland kwatta kyivstar kyocera kyriazi kystlink körber
küschall labcorp lacie lactalis ladbrokes ladeco laerdal lagonda lalandia lalique lambert
lamborghini lamy lancair lancia landkredit landsbanki landsbankinn lanerossi laney lantis lantmännen
lanvin lanxess laraki lasselsberger latvenergo lavazza lawotschkin lawson lazada lazard leadtek leaf
learjet leaseplan leatherman lebaron lebedjanski leblanc leeco legea legoland legrand leidos
lekkerland lely lemania lemken lemminkäinen lemonade lendlease lennar lenovo lensbaby lenscrafters
lenta lenzing leonardo leoni leonteq leovegas letterone leviton lexar lexicon leybold liaz liberbank
libero libyana lidl lifecell lifescan lifosa light lightinthebox lightspeed lima lime limesurvey
linamar lincoln linde lindex linguatec linksys linktree lionbridge lipton listerine litgrid
litostroj littelfuse liugong livescribe lixil lkab loacker loake localiza locanto loctite loewe
logitech lollapalooza lomo longines lonmin lonza looker looksmart loopt lotteria lottomatica lovable
lovablehh lovefilm lubrizol ludicorp lufthansa lukoil lumene luminox lunajets lundbeck lusa
luxanimation luxempart luxexpress luxgen luxlait luxman luxoft luxottica luxshare lyft lynas
lyondellbasell lyoness läderach länderbank lürssen mace macplay maffei mafra mages magnavox magnit
magnussoft mahindra mahle maidenform mailchimp mainbocher maizena makerbot makita makro malaco
mallinckrodt malossi malwarebytes mammoet mamod mandiant manet manfrotto mangagamer mango manner
mannesmann manpowergroup mapfre mapillary mapquest mapr marantz marcegaglia marcopolo marel marfrig
marimekko marketo marketwatch marktplaats marmon marmot marratech marshalls martifer martini
marubeni maruhan marui marvelous marzotto maserati masita massmart mastercard mastercraft
mastertronic matador matalan match mateba materfer materialise mathmos mathsoft matisa matsuzakaya
mattel mauritel maxam maxell maxingvest maxus maxxis maybank maybelline maytag mazars mazda mcafee
mcarthurglen mcclatchy mckesson mcot mdpi mdtv meccano mechel mecom meda medac medco mediaboard
mediacom mediacorp mediaforeurope mediahuis mediakind medialaan mediapro mediatek medibank
mediobanca mediolanum medion medochemie medtronic megacable megafon megatron meggitt mehano meiji
meitetsu meituan meizu mekorot melco melexis melitta meltwater memorex memotech memphis memrise
menards menarini mennekes meopta meralco mercari mercator mercer mercitalia merida meritor merkur
merlo mermec merrell mervyns messer mesta metabo metalac metalloinvest metallpatronen metaplan
metaweb meteoblue metersbonwe methanex metinvest metka metlife metro metrohm metrostav metso metsä
metz metzeler mevgal mexichem mgts michaels miche michelin microcabin microdeal microgaming
micrografx microsemi microsoft microstrategy midea mido miele mikrogen mikuni millarworld
millercoors millicom mimos minebea minichamps miniso minol minolta miramax mirrorsoft mirvac missha
mistwalker mitac mitel mitie mitropa mitsubishi mitsui mitsumi mittelwerk mixue mlekovita mobifone
mobike mobil mobilepay mobileye mobilink mobily mobipocket mobitel mobiwire moderna modezeitschrift
moen moeve moldtelecom molex molson molten monami moncler mondaine mondi mondia mondomedia monese
moneygram mongodb monier monsanto montavista montblanc moodyz moonstone moov mopar morattab
morellato morningstar moschino moscot mosenergo moser mosrite mostotrest motoczysz motoman motorex
motorola motta moulinex movado movia moviepass movieweb movistar mowi moxa moxie mozal msci mtel
mtva mubi muji mulberry mulesoft mullard multilaser multimatic multitude mundipharma mundys
musixmatch mutares mutti myanimelist mygale myheritage mykita mylan myntverket mytheresa mywikibiz
mzst möbelix mövenpick müller nabisco naftal naftogaz nagaswara nakumatt nalco nankang narus
narvesen naspers nassco nationsbank naturgy nautica nautilus navel navico navistar navman nbbj ncube
nebius nebula necchi neckermann nedap neles nema nemak neoman neon neonode neoplan nero nespresso
neste netafim netapp netcare netcraft netease netezza netgear netia netjets netlify nets netsuite
neuralink neusoft neutrogena newag nexgen nexi nexon next nextag nextbike nextdoor nexton nibulon
nichia nichicon nichirei nici nidar niederegger niit nike nikoli nikon nimsoft ninebot nintendo
nipro nishat nisource nissan njalla nlmk nobiskrug noble noctua nokia nominet nordea nordex nordica
nordkalk nordmende nordnet nordseewerke nordstrom nordtrafikk nordvpn nordzucker norgesgruppen
norinco noritake norli norma norman nornickel nortal nortel northvolt nortura notino novaport
novartis novasol novavax novelis novell novitec novo novonesis novozymes nowatek nowator nowo
noxzema ntmk nubank nuclearelectrica nucor nuctech nufarm nuix numico numonyx nunagreen nurofen
nutanix nutreco nutricia nutrien nuveen nvidia nykredit nynas nyrstar nzxt oatly oberbank oberheim
obike obolon obos ocado oceanco oceangate octapharma odex odfjell odido odlo odoo officemax okbm
oklo oknoplast oktava olerex olivetti oltcit olvi olympus omantel omega omegle omio omnicom omron
omya onavo onefootball oneok oneplus onerpm onespan onesubsea oniverse onkyo onlive ooredoo opap
opavia opekta openbank opencorporates opendns opentable openweathermap opet opmobility opodo oppo
optus oracle orange orbcomm orbea orbitel orbotech organon orica oricon oris orix orlen ornua orsay
ortofon orwo osca osprey otard otava otomo otrag ottobock oukitel outbrain outokumpu outotec ovation
overflow overland ovintiv ozon paccar packard pacsun padlet paiste palfinger palmsource panamsat
panasonic panavision pandora panhard panic pantech pantene papadopoulos parallels parc parexel
parfois parmalat parship partners pascha pasibus patagonia patientslikeme patria paxman paychex
payoneer paysafe paytm payu pccw peacocks pearl pearson peavey pechiney pedidosya pegaso pegasystems
pegatron pelephone pelikan peloton pemex pennon penny pennzoil pentacon pentagram pentaho pentair
pentax pentland peoplenet peoplesoft pepco pepsiamericas pepsico perenco peri perlini perrigo
persimmon persol pescanova petco peterbilt petrobras petrochina petroecuador petrof petrofac
petrofina petrol petronor petrosa petrotrin petrovietnam petsmart pewex pfaff pfanni pfeiffer pfizer
pfleiderer pgim pharmacia pharmstandard philips phison phoenix piaget piazza picanol pick piczo piko
pilkington pilz pinfari ping pinkberry pioneer pipistrel piratförlaget pirelli piriform pixomondo
pixum plaion planmeca plantronics plarium plaxo plaxton play playasia playfirst playism playrix
playtech playtronic plby pldt plessey plextor plinacro pliva plukon plustek pobeda pocketbook
pocketpair podravka poggenpohl pokerstars polaroid polmos polsteam polycom polygon pomellato pono
ponsse porsche portalplayer posbank posco postbank postemobile postfinance posti postnl poundland
powercolor prada praktiker praxair preem pressreader preussag preussenelektra prfoods primark primus
prinoth printrbot pripps pritt priwatbank proactiv prodigy prodrive prologis prologium prometric
promswjasbank proqr prosafe prosegur prosus protomotors protostar protram proximus prudential
prysmian psinet ptcl pterodon publix pultegroup puma purcari putzmeister pyramis pyrkal qatargas
qeelin qemetica qiagen qimonda qiwi qlik qnap qorvo qualcomm qualtrics qualys quicksilva quiksilver
quiktrip quooker quora qwest qype raaberbahn racal rackspace radical radionette radioshack rado
radview radvision radwin rafael raiadrogasil railpower raisio raja rakhat rakuten ralcorp ralink
ralliart rama ramboll rambus ramstore rancilio rapala rasgas raspadskaja rational ratos rautakirja
rautaruukki rawlings raytheon razer readly realme realtek recaro reckitt recruit redbox redbubble
redfern redfin redion redlettermedia redoctane reebok reef refinitiv reformhaus refresco regent
regnecentralen reguladora rehau reliant relx remgro remilk remington remondis renata renco rendition
renewi renishaw renk renren replit reply repower reprisk repsol resmed rethmann reusch reverbnation
revlon revox rewe rexall rexam rexel rheinmetall richemont rickenbacker ricoh ridgid rieker rieter
rightmove rimmel rimowa ring rinnai ripple riseba ritek rites rittal rivarossi riverbed rivian rizla
roamer robinhood roborock robot rocar rocawear rocketdyne rockwool roco rodarte rodenbach rodenstock
rohloff rohm roketsan roku roland rollei rollerblade rolm romai roman romet rompetrol romstar ronal
ronda rongbaozhai ropit rosbank rosenthal roshan roshel rosnano rosneft rosneftegaz rosseti rossija
rossmann rostelekom rosterminalugol rostselmasch rostvertol rosukrenergo rotaprint roton rotring
rover rowenta roxy rubbermaid rubix rubrik rusagro rusal rushydro rusta ruter ryanair ryobi röhm
saba sabca sabesp sabic sabmiller sabritas sace sachtler sadia safaricom safenet safeway safilo
safra saic saipem saitek sako salamander salesforce salling salmar salmson saluc salvi salzgitter
samherji sampo samsonite sandeman sandforce sandisk sandora sandvik sangaria sangean sanhua sanitec
sanlam sanmina sanoma sanrio sans santos sany sanyo sapo saporoshstahlwerk sappi saputo saras
saremar sarens saria sartorius sasktel sasol saucony sava savers savills sawstop sazgar sberbank
scality scandlines scarpa schaeffler schenker scheppach schiedel schlauchtuch schlosser schlumberger
scholastic schott schroders schuberth schunk schwing scintilla scotiabank screenrant scytl sdek sdlg
seadrill seafrance seagen sears seaworld secom securicor securly sedo seeqpod segro seiko seiyu
selgros sellafield sellbytel sellita selver sematech semcon semikron seminis semperit semrush sener
sennebogen sensenich sensetime sentinel senvion sera serco servicenow sescoi setad sevel severstal
sharkninja sharp sharpie sheaffer sheetz shein shelfari shell sheraton shibaura shide shimadzu
shimano shine shinsegae shionogi shire shirokiya shiseido shodensha shoei shooto shophq shopify
shougang shufersal shure shutterstock sibelco sibirtelekom sibur sibylla sick sicpa sidi sidushq
siel siematic siemens sieper sifive sigg sigma signify sika silca silmet siltronic silwinit simcorp
similarweb simplot simyo sinalco sinar singulart singulato sinn sinochem sinopec sinopharm sinotrans
sinotruk sinovel siremar sistema sita sitecore sitronics sivantos sixt skanska skechers skellerup
sketchfab sklavenitis skretting skrill skrivanek skullcandy skydance skydio skyeurope skyguide
skysails skytrax skyworks skyworth slatnar slazenger slovalco slovnaft smartcat smartfren smartisan
smartone smirnoff smiths smythson snam snoras snvi socapex socialbakers sodastream sodiam sodomka
soennecken sofi sofina softbank softclub softlayer softronic softserve softwareone sogaz sogeade
sogenal sogrape sohu soilmec sojaprotein sojitz solarcity solaredge solaris solarstratos solarwinds
solarworld solectron solidere soligor sollers solon solvay solyndra somerfield sonaca sonangol
sonasid sonax sonelgaz songkick songza sonicwall sonoco sonor sonos sonova sony sorefame soriana
soribada sorin sortimo sotelma sotsu soubry soudal soundhound sourcefire sowkomflot soylent spacecom
spacemobile spacex spacexai spansion spanx spartannash specialized specsavers spector spectris
spectrum speedo speedway spendrups spica spicejet splunk sportradar sporveien spreadshirt spreadtrum
sprfmo spyderco spyglass square squarespace squidoo srbijagas ssab stada staedtler stagecoach stan
stankoprom stantec starobrno statista statkraft statnett statskog steag steelcase steelseries
stefanel steiff stelco stellantis stelton stemrad stericycle steris stihl still stimorol stobart
stockland stodir storebrand stork stormgeo storytel strabag stratasys strategy strato straumann
strauss strida stripe stroitransgas strömberg studebaker studenac studer stumbras stäubli stüssy
substack suchard sudatel suek sugarcrm suitsupply sulzer sumco sumol sundbusserne sunedison sungard
sunnet sunoco sunopta sunovion sunpower sunrun sunseeker suntory suntour supacat supercell superdry
superfish superga superkombat supermicro superscape supervalu supreme surgutneftegas surplex
surveymonkey suse suunto suzuki sveaskog svema swagelok swatch sweco swedbank sweetgreen swetlana
swiftkey swing swingline swire swisscom swissgrid swissport swissquote swjasinwest sybase syensqo
sygic symrise synanon synaptics synergy synertek synetic synlab synnex synology synopsys synoptics
synovate synthes synthomer synthos syriatel sysco sysinternals sysmex systemair südzucker sümerbank
taboola tadano taekwang taito taittinger takashimaya takata takeuchi takraf talanx talbots talgo
taligent talktalk tallink tamedia tamiya tamoil tampella tamro tamron tanduay tanesco tango tannoy
tapout tascam tasr tatneft tatra tattersall tatung tatuus taurus taxan taylor taylormade tchibo teac
teamviewer teany teavana teboil tecan techint technify technipfmc technisat technoalpin
technodynamika technogym technos techsnabexport tecmasch tecmo tecnica tecnomatix tectoy tedi tedmed
tedom teegschwendner teekanne teijin teisco teka tekla tekno teksid tektronix telcel teldec
telecable teledyne teleflex telefunken telelogic telenet telenor telent telerik telesat teletalk
televideo televisa telfort telit telkom tellabs telmex telstra telus temax temenos temmler temperino
tempo tempur temsa tencent tengelmann tengizchevroil tenneco tennet tenor tensilica tentamus tepco
teradata teradyne terberg teremok terex terma ternium terpel terracycle terrafugia terrapower terumo
tesa tesco tesla tessellis testo tetley tetra tetterode texaco text textron teyon thaicom thalia
thawte thecus thermaltake thermoplan thiokol thomann thonet thorens thorntons thule thulinverken
thuraya thyssen tibco tibhar ticketbis ticketmaster tickford tidewater tietoevry tiffen tilera
tillig tilray timberland time timex tispan tissot titleist titoni tiwag tkms togliattiazot tokidoki
tokina tokopedia tokuyama tokyopop tombow tomtom tomy tonka topcon topman topshop topsoe toray
torchmark toremar torm torstar toshiba total totalenergies totalerg toto tottus totvs toyota tper
tradedoubler tradewest tradingview trafigura trainline trane transcend transdev transdigm
transelectrica transener transfennica transmashholding transmeta transneft transnet transocean
transpetrol transsion transtech transunion transurban traton travco travelbird travelers travelex
travelodge traveloka trayal trek trekstor tresorit trigranit trijicon trilux trimble tripadvisor
trix troller trolli trolsa tronox trotec trovit trussardi trust trustpilot tryg tscherkisowo
tsingtao tsmc tsst ttnet tuborg tucows tudor tuenti tumi tungsram tunturi tupperware turck turkcell
turkmengaz turnitin tusass tussauds twel twilio twint twizzlers typeform tänapäev türksat uber
ubiquiti ucell uddevallavarvet ufaneftekhim ufone ugreen uher uipath ukash ukrhydroenergo ukrnafta
ukrsotsbank ukrtelecom ulead ultramagic ultramar ultraphon ultrasone umbro umicore umidigi umios
umniah underwood unfi unicharm unicomp unicredit uniden unify unilever unimation uniper unipol
unipro uniqlo unisys unite united unitedhealth unitel unitika univar univel universul unsplash
untangle uponor uproxx upwork uralchem uralkali uralsvyazinform uraltransmasch uralwagonsawod urenco
urovesa ursus usaa usbekfilm usia usiminas usinor usrobotics utstarcom utva uunet uuum uvision
uzbekneftegaz uztelecom vacansoleil vaccitech vaio vaisala valcambi vale valeant valentino valio
valmet valnet valora valpadana valspar valvoline vanmoof vans varrak varta vasakronan vattenfall
vaude vaxart vbet veba veeam veilside veka velleman venchi venmo venrock veon veoneer verbatim
verbio verbund verifone verisign verisure versalis versatile vertiv vertu veryday vestas vesuvius
vetements viacom viagogo viaplay viasat vibroplex vicat vichy victor victrex videoton vidrala viega
viessmann vietcombank vietinbank vietnamobile viewsonic viki viking vileda vilmorin vimeo vimpelcom
vinacomin vinamilk vinaphone vindija vinfast vinmonopolet vinsmart viohalco vipshop virgin virtusa
visa visana viscofan vishay visicorp vistaprint visteon vistry viterra vitol vitra vitsoe vittoria
vivacom vivantes vivartia vivendi vivo vixen vizio vmware vobis vodafoneziggo voiello voigtländer
volcom volkerwessels volkswagen volkswind vollmer volocopter volvo vonovia vontobel voot vopak
vorwerk vossloh voxeljet vredestein vtech vyond völkl wabco wabtec wacom wago walgreens walkers
wallace walmart walmex walter wanda wander warburtons warnermedia wartski warwick wasa watcha
watchguard waterman wawa wawel waxholmsbolaget wayfair waymo weatherby webank webasto webfleet
webhelp webmoney webuild weekendavisen wega weidemann weihrauch weir weis weitek weleda wellcome
wenger wepay wereldhave wersi wesc wesfarmers westclox westfield westpac westrock wework
weyerhaeuser whoop whsmith widex wielton wienerberger wiesmann wiggle wikitribune wildberries
wildbrain wilesco wiley wilkhahn willis wilo winbond windowswear windstream wingstop wingstreet
winmau wintershall wipro wire wirecard wirtgen wistron witricity wittenstein wizkids
wneschekonombank wolford wolfspeed wolgatelekom wolt wood woodward woolworths woot workday workhorse
worldspace worleyparsons worten worth wortmann wostok wowow wowwee wrightbus wrike wsoy wuesthof
wuliangye wunderman wuzheng wyeth wärtsilä würth xado xamarin xbiz xcmg xella xerox xfinity xiaomi
xilinx xinuos xlsmart xonox xpeng xsolla xunlei xxxlutz xylem yahoo yahsat yamasa yanase yandex
yashica yealink yelp yoigo yokohama yonex youku youngor yukos yuneec yutong zagat zain zalando
zalman zanella zango zanotta zanussi zapf zappos zedge zegna zello zeltia zendesk zenith zenkyoren
zenrin zentis zentiva zentrenerho zentropa zesco zetor zettle zhihu ziggo zildjian zillow zilog
zinifex zipcar zizzi zodiac zoetis zomato zong zoominfo zoomlion zoox zopa zoran zotac zotye zscaler
zuken zulip zumiez zwack zwcad zylab zynga zyxel züblin össur ülker
`.trim().split(/\s+/);

const DE_COMPANY_NOUNS = new Set(DE_NOUN_LEMMAS);

/** Firmenkurzname, der zugleich ein deutsches Substantiv-Lemma ist. Ein Treffer bleibt ein Redo. */
export const DE_COMPANY_AMBIGUOUS: string[] = DE_COMPANY_NAMES.filter(name => DE_COMPANY_NOUNS.has(name));
