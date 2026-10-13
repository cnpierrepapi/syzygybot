// Where the Contact finder looks for decision makers. Every source here publishes named people with
// their titles (hires, promotions, interviews, speaker bios, award lists, filings) or published press
// inboxes. LinkedIn is deliberately absent: its terms ban automated access.
// `npm run sources:test` checks each domain with our honest bot user agent and writes the result to
// data/sources-status.json; the sweep only reads pages from sources that answered.

export type SourceGroup =
  | "wire" | "marketing" | "pr" | "media_business" | "film_tv" | "music" | "live" | "sports" | "fashion" | "beauty"
  | "retail" | "food_bev" | "drinks" | "gaming" | "tech" | "auto" | "luxury_travel" | "business" | "conference"
  | "awards" | "registry" | "talent" | "regional_eu" | "regional_apac" | "regional_americas_mea";

export type Source = { domain: string; name: string; group: SourceGroup };

// "domain|Name" per line, grouped. Kept as text so the list stays easy to scan and extend.
const RAW: Record<SourceGroup, string> = {
  wire: `
prnewswire.com|PR Newswire
businesswire.com|Business Wire
globenewswire.com|GlobeNewswire
accesswire.com|ACCESSWIRE
einpresswire.com|EIN Presswire
newswire.com|Newswire
prweb.com|PRWeb
cision.com|Cision
newswire.ca|Canada Newswire
mynewsdesk.com|Mynewsdesk
presseportal.de|Presseportal
pressat.co.uk|Pressat
24-7pressrelease.com|24-7 Press Release
openpr.com|openPR
prlog.org|PRLog
issuewire.com|IssueWire
newsfilecorp.com|Newsfile
markets.businessinsider.com|Markets Insider press releases
finance.yahoo.com|Yahoo Finance press releases
stocktitan.net|Stock Titan
marketscreener.com|MarketScreener
businesswire.de|Business Wire DE
prnewswire.co.uk|PR Newswire UK
aap.com.au|AAP Medianet
pressebox.de|PresseBox
`,
  marketing: `
adweek.com|Adweek
adage.com|Ad Age
campaignlive.com|Campaign
campaignlive.co.uk|Campaign UK
thedrum.com|The Drum
marketingdive.com|Marketing Dive
mediapost.com|MediaPost
digiday.com|Digiday
marketingweek.com|Marketing Week
marketingbrew.com|Marketing Brew
musebyclios.com|Muse by Clio
lbbonline.com|Little Black Book
shots.net|shots
adforum.com|AdForum
adsoftheworld.com|Ads of the World
creativereview.co.uk|Creative Review
itsnicethat.com|It's Nice That
adnews.com.au|AdNews
bandt.com.au|B&T
mumbrella.com.au|Mumbrella
campaignasia.com|Campaign Asia
campaignbrief.com|Campaign Brief
adobomagazine.com|adobo magazine
exchange4media.com|exchange4media
afaqs.com|afaqs
brandequity.economictimes.indiatimes.com|ETBrandEquity
marketing-interactive.com|Marketing-Interactive
strategyonline.ca|Strategy
mediaincanada.com|Media in Canada
marketingmag.com.au|Marketing Mag
cmo.com.au|CMO Australia
cmswire.com|CMSWire
martech.org|MarTech
chiefmarketer.com|Chief Marketer
ana.net|ANA
warc.com|WARC
brandingmag.com|Branding Mag
thebrandingjournal.com|The Branding Journal
marketingtechnews.net|Marketing Tech News
adexchanger.com|AdExchanger
tvrev.com|TVREV
cynopsis.com|Cynopsis
emarketer.com|eMarketer
insiderintelligence.com|Insider Intelligence
contentmarketinginstitute.com|Content Marketing Institute
socialmediatoday.com|Social Media Today
tubefilter.com|Tubefilter
netinfluencer.com|Net Influencer
influencermarketinghub.com|Influencer Marketing Hub
businessofinfluencers.com|Business of Influencers
sponsorship.com|IEG Sponsorship
sponsorshipnews.com|Sponsorship News
cmocouncil.org|CMO Council
cmoalliance.com|CMO Alliance
brandinnovators.com|Brand Innovators
thecmoclub.com|The CMO Club
mmaglobal.com|MMA Global
iabuk.com|IAB UK
iab.com|IAB
`,
  pr: `
prweek.com|PRWeek
odwyerpr.com|O'Dwyer's
provokemedia.com|PRovoke Media
prdaily.com|PR Daily
prnewsonline.com|PR News
holmesreport.com|Holmes Report
everything-pr.com|Everything PR
spinsucks.com|Spin Sucks
prmoment.com|PRmoment
ragan.com|Ragan
`,
  media_business: `
axios.com|Axios
semafor.com|Semafor
thewrap.com|TheWrap
puck.news|Puck
niemanlab.org|Nieman Lab
pressgazette.co.uk|Press Gazette
mediaweek.com.au|Mediaweek
nexttv.com|Next TV
tvtechnology.com|TV Technology
broadcastingcable.com|Broadcasting+Cable
streamtvinsider.com|StreamTV Insider
fiercevideo.com|Fierce Video
lightreading.com|Light Reading
mediaplaynews.com|Media Play News
thestreamable.com|The Streamable
whats-on-netflix.com|What's on Netflix
podnews.net|Podnews
insideradio.com|Inside Radio
radioink.com|Radio Ink
radiotoday.co.uk|RadioToday
`,
  film_tv: `
variety.com|Variety
hollywoodreporter.com|The Hollywood Reporter
deadline.com|Deadline
indiewire.com|IndieWire
screendaily.com|Screen International
boxofficepro.com|Boxoffice Pro
filmmakermagazine.com|Filmmaker
cineuropa.org|Cineuropa
broadcastnow.co.uk|Broadcast
c21media.net|C21Media
tbivision.com|TBI
realscreen.com|Realscreen
kidscreen.com|Kidscreen
worldscreen.com|World Screen
televisual.com|Televisual
animationmagazine.net|Animation Magazine
cartoonbrew.com|Cartoon Brew
awn.com|Animation World Network
backstage.com|Backstage
thefilmstage.com|The Film Stage
collider.com|Collider
slashfilm.com|/Film
screenrant.com|Screen Rant
ew.com|Entertainment Weekly
vulture.com|Vulture
tvline.com|TVLine
tvinsider.com|TV Insider
programminginsider.com|Programming Insider
thedesk.net|The Desk
filmindependent.org|Film Independent
sundance.org|Sundance Institute
tribecafilm.com|Tribeca
festival-cannes.com|Festival de Cannes
berlinale.de|Berlinale
tiff.net|TIFF
labiennale.org|La Biennale di Venezia
sxsw.com|SXSW
mipcom.com|MIPCOM
miptv.com|MIPTV
natpe.com|NATPE
bafta.org|BAFTA
oscars.org|The Academy
emmys.com|Television Academy
goldenglobes.com|Golden Globes
mpa-apac.org|MPA Asia Pacific
motionpictures.org|Motion Picture Association
`,
  music: `
billboard.com|Billboard
musicbusinessworldwide.com|Music Business Worldwide
musicweek.com|Music Week
hitsdailydouble.com|HITS Daily Double
pollstar.com|Pollstar
musically.com|Music Ally
completemusicupdate.com|CMU
hypebot.com|Hypebot
digitalmusicnews.com|Digital Music News
musicconnection.com|Music Connection
rollingstone.com|Rolling Stone
pitchfork.com|Pitchfork
stereogum.com|Stereogum
consequence.net|Consequence
nme.com|NME
complex.com|Complex
thefader.com|The FADER
hiphopdx.com|HipHopDX
xxlmag.com|XXL
uproxx.com|Uproxx
djmag.com|DJ Mag
mixmag.net|Mixmag
residentadvisor.net|Resident Advisor
edm.com|EDM.com
iq-mag.net|IQ Magazine
amplifymusic.com|Amplify
musicrow.com|MusicRow
countryaircheck.com|Country Aircheck
celebrityaccess.com|CelebrityAccess
riaa.com|RIAA
ifpi.org|IFPI
bpi.co.uk|BPI
grammy.com|Recording Academy
cmaworld.com|Country Music Association
musicbiz.org|Music Business Association
a2im.org|A2IM
ascap.com|ASCAP
bmi.com|BMI
sesac.com|SESAC
nmpa.org|NMPA
umusic.com|Universal Music
sonymusic.com|Sony Music
wmg.com|Warner Music Group
bmg.com|BMG
concord.com|Concord
beggars.com|Beggars Group
`,
  live: `
livenationentertainment.com|Live Nation
aegpresents.com|AEG Presents
ticketmaster.com|Ticketmaster
eventbrite.com|Eventbrite
venuesnow.com|VenuesNow
tsnn.com|TSNN
bizbash.com|BizBash
eventmarketer.com|Event Marketer
specialevents.com|Special Events
exhibitoronline.com|Exhibitor
eventindustrynews.com|Event Industry News
access-aa.co.uk|Access All Areas
festivalinsights.com|Festival Insights
coachella.com|Coachella
glastonburyfestivals.co.uk|Glastonbury
`,
  sports: `
sportbusiness.com|SportBusiness
sportsbusinessjournal.com|Sports Business Journal
frontofficesports.com|Front Office Sports
sportspromedia.com|SportsPro
sportico.com|Sportico
insidersport.com|Insider Sport
blackbookmotorsport.com|BlackBook Motorsport
sportsvideo.org|Sports Video Group
sportstechie.net|SportTechie
athleticbusiness.com|Athletic Business
footballbenchmark.com|Football Benchmark
offthepitch.com|Off The Pitch
twoCircles.com|Two Circles
leadersinsport.com|Leaders in Sport
insideworldfootball.com|Inside World Football
insidethegames.biz|Inside the Games
theathletic.com|The Athletic
espn.com|ESPN
skysports.com|Sky Sports
nba.com|NBA
nfl.com|NFL
mlb.com|MLB
nhl.com|NHL
mlssoccer.com|MLS
premierleague.com|Premier League
laliga.com|LaLiga
legaseriea.it|Serie A
bundesliga.com|Bundesliga
ligue1.com|Ligue 1
uefa.com|UEFA
fifa.com|FIFA
olympics.com|IOC
formula1.com|Formula 1
nascar.com|NASCAR
wnba.com|WNBA
nwslsoccer.com|NWSL
atptour.com|ATP Tour
wtatennis.com|WTA
pgatour.com|PGA Tour
ufc.com|UFC
wwe.com|WWE
esportsinsider.com|Esports Insider
esportsobserver.com|The Esports Observer
dotesports.com|Dot Esports
sportsmediawatch.com|Sports Media Watch
awfulannouncing.com|Awful Announcing
sportsbusinessdaily.com|Sports Business Daily
sportcal.com|Sportcal
sportsvalue.com.br|Sports Value
palcosports.com|Palco Sports
`,
  fashion: `
wwd.com|WWD
businessoffashion.com|The Business of Fashion
fashionista.com|Fashionista
drapersonline.com|Drapers
glossy.co|Glossy
fashionunited.com|FashionUnited
fashionunited.uk|FashionUnited UK
sourcingjournal.com|Sourcing Journal
footwearnews.com|Footwear News
hypebeast.com|Hypebeast
highsnobiety.com|Highsnobiety
fashionnetwork.com|FashionNetwork
thecut.com|The Cut
vogue.com|Vogue
vogue.co.uk|British Vogue
harpersbazaar.com|Harper's Bazaar
elle.com|ELLE
gq.com|GQ
esquire.com|Esquire
complexcon.com|ComplexCon
apparelnews.net|California Apparel News
just-style.com|Just Style
textileexcellence.com|Textile Excellence
fibre2fashion.com|Fibre2Fashion
modaes.com|Modaes
pambianconews.com|Pambianco
fashionmagazine.it|FashionMagazine
mffashion.com|MF Fashion
journalduluxe.fr|Journal du Luxe
luxurydaily.com|Luxury Daily
jingdaily.com|Jing Daily
luxurysociety.com|Luxury Society
thefashionlaw.com|The Fashion Law
cfda.com|CFDA
britishfashioncouncil.co.uk|British Fashion Council
camera-moda.it|Camera Nazionale della Moda
fhcm.paris|Federation de la Haute Couture
`,
  beauty: `
beautyindependent.com|Beauty Independent
cosmeticsbusiness.com|Cosmetics Business
cosmeticsdesign.com|CosmeticsDesign
cosmeticsdesign-europe.com|CosmeticsDesign Europe
cosmeticsdesign-asia.com|CosmeticsDesign Asia
globalcosmeticsnews.com|Global Cosmetics News
happi.com|Happi
gcimagazine.com|GCI Magazine
beautypackaging.com|Beauty Packaging
premiumbeautynews.com|Premium Beauty News
allure.com|Allure
byrdie.com|Byrdie
intothegloss.com|Into The Gloss
beautymatter.com|BeautyMatter
cew.org|Cosmetic Executive Women
personalcarecouncil.org|Personal Care Products Council
cosmeticsandtoiletries.com|Cosmetics & Toiletries
spaandbeauty.com|Spa Business
`,
  retail: `
retaildive.com|Retail Dive
modernretail.co|Modern Retail
retailtouchpoints.com|Retail TouchPoints
chainstoreage.com|Chain Store Age
progressivegrocer.com|Progressive Grocer
grocerydive.com|Grocery Dive
supermarketnews.com|Supermarket News
nrf.com|National Retail Federation
retailgazette.co.uk|Retail Gazette
retail-week.com|Retail Week
thegrocer.co.uk|The Grocer
essentialretail.com|Essential Retail
retailwire.com|RetailWire
retailbrew.com|Retail Brew
practicalecommerce.com|Practical Ecommerce
digitalcommerce360.com|Digital Commerce 360
ecommercetimes.com|E-Commerce Times
pymnts.com|PYMNTS
shoptalk.com|Shoptalk
csnews.com|CSNews
cstoredive.com|C-Store Dive
nacsonline.com|NACS
storebrands.com|Store Brands
drugstorenews.com|Drug Store News
licenseglobal.com|License Global
licensingmagazine.com|Licensing Magazine
licensingsource.net|Licensing Source
licensinginternational.org|Licensing International
toyworldmag.co.uk|Toy World
toybook.com|The Toy Book
playthings.com|Playthings
`,
  food_bev: `
bevnet.com|BevNET
nosh.com|NOSH
beveragedigest.com|Beverage Digest
bevindustry.com|Beverage Industry
just-drinks.com|Just Drinks
just-food.com|Just Food
fooddive.com|Food Dive
foodnavigator.com|FoodNavigator
foodnavigator-usa.com|FoodNavigator-USA
foodnavigator-asia.com|FoodNavigator-Asia
beveragedaily.com|BeverageDaily
dairyreporter.com|DairyReporter
bakeryandsnacks.com|Bakery and Snacks
confectionerynews.com|ConfectioneryNews
foodbusinessnews.net|Food Business News
fooddrinkeurope.eu|FoodDrinkEurope
qsrmagazine.com|QSR Magazine
restaurantdive.com|Restaurant Dive
nrn.com|Nation's Restaurant News
restaurantbusinessonline.com|Restaurant Business
fsrmagazine.com|FSR Magazine
foodandwine.com|Food & Wine
eater.com|Eater
thespoon.tech|The Spoon
agfundernews.com|AgFunderNews
foodbev.com|FoodBev Media
snackandbakery.com|Snack Food & Wholesale Bakery
candyindustry.com|Candy Industry
specialtyfood.com|Specialty Food Association
`,
  drinks: `
thespiritsbusiness.com|The Spirits Business
thedrinksbusiness.com|The Drinks Business
shankennewsdaily.com|Shanken News Daily
bevalcinsights.com|Bevalc Insights
drinksint.com|Drinks International
imbibemagazine.com|Imbibe
liquor.com|Liquor.com
winespectator.com|Wine Spectator
decanter.com|Decanter
winesearcher.com|Wine-Searcher
beerbusinessdaily.com|Beer Business Daily
brewbound.com|Brewbound
craftbrewingbusiness.com|Craft Brewing Business
morningadvertiser.co.uk|The Morning Advertiser
thirtyfiftybusiness.com|3050 Business
drinksretailingnews.co.uk|Drinks Retailing
harpers.co.uk|Harpers Wine & Spirit
beveragedynamics.com|Beverage Dynamics
cheersonline.com|Cheers
sevenfifty.com|SevenFifty Daily
distilledspirits.org|DISCUS
`,
  gaming: `
gamesindustry.biz|GamesIndustry.biz
gamedeveloper.com|Game Developer
pocketgamer.biz|PocketGamer.biz
venturebeat.com|VentureBeat
gamesbeat.com|GamesBeat
mcvuk.com|MCV/Develop
develop-online.net|Develop
gamerant.com|Game Rant
polygon.com|Polygon
kotaku.com|Kotaku
ign.com|IGN
eurogamer.net|Eurogamer
pcgamer.com|PC Gamer
gamespot.com|GameSpot
theverge.com|The Verge
dualshockers.com|DualShockers
mobilegamer.biz|MobileGamer.biz
gamingintelligence.com|Gaming Intelligence
esportsnews.uk|Esports News UK
theesportsobserver.com|Esports Observer
`,
  tech: `
techcrunch.com|TechCrunch
wired.com|WIRED
engadget.com|Engadget
cnet.com|CNET
arstechnica.com|Ars Technica
zdnet.com|ZDNET
geekwire.com|GeekWire
siliconangle.com|SiliconANGLE
theinformation.com|The Information
businessinsider.com|Business Insider
fastcompany.com|Fast Company
inc.com|Inc.
entrepreneur.com|Entrepreneur
sifted.eu|Sifted
tech.eu|Tech.eu
eu-startups.com|EU-Startups
techinasia.com|Tech in Asia
restofworld.org|Rest of World
crunchbase.com|Crunchbase News
`,
  auto: `
autonews.com|Automotive News
autonews.com.au|Automotive News Australia
automotiveworld.com|Automotive World
just-auto.com|Just Auto
autocar.co.uk|Autocar
motor1.com|Motor1
carscoops.com|Carscoops
autoblog.com|Autoblog
caranddriver.com|Car and Driver
motortrend.com|MotorTrend
topgear.com|Top Gear
electrek.co|Electrek
insideevs.com|InsideEVs
wardsauto.com|WardsAuto
automotive-fleet.com|Automotive Fleet
am-online.com|AM Online
autoevolution.com|autoevolution
motorionline.com|Motori Online
quattroruote.it|Quattroruote
duemotori.com|DueMotori
robbreport.com|Robb Report
duPontregistry.com|duPont Registry
`,
  luxury_travel: `
skift.com|Skift
travelweekly.com|Travel Weekly
travelweekly.co.uk|Travel Weekly UK
ttgmedia.com|TTG Media
hotelmanagement.net|Hotel Management
hospitalitynet.org|Hospitality Net
hotelnewsnow.com|Hotel News Now
costar.com|CoStar
phocuswire.com|PhocusWire
travelpulse.com|TravelPulse
breakingtravelnews.com|Breaking Travel News
hospitalitydesign.com|Hospitality Design
hotelsmag.com|HOTELS
traveldailynews.com|Travel Daily News
cntraveler.com|Conde Nast Traveler
travelandleisure.com|Travel + Leisure
departures.com|Departures
whitewall.art|Whitewall
artnews.com|ARTnews
artnet.com|Artnet News
theartnewspaper.com|The Art Newspaper
dezeen.com|Dezeen
designboom.com|designboom
wallpaper.com|Wallpaper
architecturaldigest.com|Architectural Digest
`,
  business: `
forbes.com|Forbes
fortune.com|Fortune
bloomberg.com|Bloomberg
reuters.com|Reuters
apnews.com|AP News
wsj.com|The Wall Street Journal
ft.com|Financial Times
nytimes.com|The New York Times
washingtonpost.com|The Washington Post
theguardian.com|The Guardian
bbc.com|BBC
cnbc.com|CNBC
cnn.com|CNN
latimes.com|Los Angeles Times
bizjournals.com|American City Business Journals
crainsnewyork.com|Crain's New York
chicagobusiness.com|Crain's Chicago
crainsdetroit.com|Crain's Detroit
crainscleveland.com|Crain's Cleveland
modernhealthcare.com|Modern Healthcare
qz.com|Quartz
businessweek.com|Bloomberg Businessweek
economist.com|The Economist
thestreet.com|TheStreet
marketwatch.com|MarketWatch
barrons.com|Barron's
investopedia.com|Investopedia
seekingalpha.com|Seeking Alpha
fool.com|The Motley Fool
morningstar.com|Morningstar
cityam.com|City A.M.
standard.co.uk|Evening Standard
independent.co.uk|The Independent
telegraph.co.uk|The Telegraph
thetimes.com|The Times (global)
scmp.com|South China Morning Post
straitstimes.com|The Straits Times
nikkei.com|Nikkei
asia.nikkei.com|Nikkei Asia
afr.com|Australian Financial Review
smh.com.au|Sydney Morning Herald
theglobeandmail.com|The Globe and Mail
financialpost.com|Financial Post
economictimes.indiatimes.com|The Economic Times
livemint.com|Mint
business-standard.com|Business Standard
`,
  conference: `
canneslions.com|Cannes Lions
advertisingweek.com|Advertising Week
ces.tech|CES
websummit.com|Web Summit
collisionconf.com|Collision
vidcon.com|VidCon
brandweek.com|Adweek Brandweek
digidayevents.com|Digiday events
festivalofmarketing.com|Festival of Marketing
dmexco.com|DMEXCO
mwcbarcelona.com|MWC Barcelona
nrfbigshow.nrf.com|NRF Big Show
shoptalkeurope.com|Shoptalk Europe
groceryshop.com|Groceryshop
possible.events|POSSIBLE
tribecax.com|Tribeca X
fastcompany.com/innovationfestival|Fast Company Innovation Festival
musicbizconference.com|Music Biz Conference
midem.com|Midem
eurosonic-noorderslag.nl|ESNS
by-larm.no|by:Larm
reeperbahnfestival.com|Reeperbahn Festival
a3c.com|A3C
sportsprolive.com|SportsPro Live
leadersweek.com|Leaders Week
sportsbusinesssummit.com|Sports Business Summit
sloansportsconference.com|MIT Sloan Sports Analytics Conference
beautyincawards.com|Beauty Inc
wwdsummits.com|WWD Summits
bofvoices.com|BoF VOICES
fashioninnovation.nyc|Fashion Innovation Agency
gdconf.com|GDC
gamescom.global|gamescom
summergamefest.com|Summer Game Fest
tedxtalks.ted.com|TEDx
ted.com|TED
aspenideas.org|Aspen Ideas
milkeninstitute.org|Milken Global Conference
slush.org|Slush
vivatechnology.com|VivaTech
nextweb.com|TNW Conference
inbound.com|INBOUND
marketingnation.com|Marketing Nation
cmosummit.com|CMO Summit
gartner.com|Gartner Marketing Symposium
brandmanagementsummit.com|Brand Management Summit
mipcancun.com|MIP Cancun
filmmart.hk|FILMART
`,
  awards: `
effie.org|Effie Awards
oneclub.org|The One Club
clios.com|The Clio Awards
webbyawards.com|The Webby Awards
shortyawards.com|The Shorty Awards
dandad.org|D&AD
andyawards.com|ANDY Awards
adcolor.org|ADCOLOR
eurobest.com|Eurobest
spikes.asia|Spikes Asia
dubailynx.com|Dubai Lynx
lia.com|London International Awards
epica-awards.com|Epica
newyorkfestivals.com|New York Festivals
thedrumawards.com|The Drum Awards
campaignbigawards.com|Campaign Big Awards
mediaawards.campaignlive.co.uk|Campaign Media Awards
adageawards.com|Ad Age awards
sabreawards.com|SABRE Awards
promaxawards.com|Promax
emmys.org|Emmy Awards
billboardmusicawards.com|Billboard Music Awards
mtv.com|MTV
iheart.com|iHeartRadio
amas.com|American Music Awards
brits.co.uk|BRIT Awards
sportsbusinessawards.com|Sports Business Awards
sportindustry.biz|Sport Industry Group
fashionawards.com|The Fashion Awards
glossyawards.com|Glossy Awards
fastcompany.com/most-innovative-companies|Fast Company Most Innovative
`,
  registry: `
sec.gov|SEC EDGAR
efts.sec.gov|EDGAR full-text search
find-and-update.company-information.service.gov.uk|Companies House
opencorporates.com|OpenCorporates
wikidata.org|Wikidata
wikipedia.org|Wikipedia
gleif.org|GLEIF LEI
annualreports.com|AnnualReports.com
investor.gov|Investor.gov
sedarplus.ca|SEDAR+
asx.com.au|ASX announcements
londonstockexchange.com|LSE RNS
borsaitaliana.it|Borsa Italiana
cnmv.es|CNMV
amf-france.org|AMF
bundesanzeiger.de|Bundesanzeiger
handelsregister.de|Handelsregister
northdata.com|North Data
infogreffe.fr|Infogreffe
registroimprese.it|Registro Imprese
`,
  talent: `
caa.com|CAA
wmeagency.com|WME
unitedtalent.com|UTA
wassermann.com|Wasserman
paradigmagency.com|Paradigm
icmpartners.com|ICM Partners
roc-nation.com|Roc Nation
rocnation.com|Roc Nation
fullstopmgmt.com|Full Stop Management
redlightmanagement.com|Red Light Management
maverick.com|Maverick
rangemp.com|Range Media Partners
3arts.com|3 Arts
anonymouscontent.com|Anonymous Content
octagon.com|Octagon
img.com|IMG
excel-sports.com|Excel Sports Management
klutchsports.com|Klutch Sports
nightingalemgmt.com|Nightingale Management
`,
  regional_eu: `
engage.it|Engage
primaonline.it|Prima Comunicazione
dailyonline.it|DailyOnline
youmark.it|YouMark
brand-news.it|Brand News
mediakey.it|Mediakey
adcgroup.it|ADC Group
touchpoint.news|Touchpoint
marketingjournal.it|Marketing Journal
ilsole24ore.com|Il Sole 24 Ore
corriere.it|Corriere della Sera
repubblica.it|la Repubblica
milanofinanza.it|Milano Finanza
calcioefinanza.it|Calcio e Finanza
marketingdirecto.com|MarketingDirecto
reasonwhy.es|Reason Why
prnoticias.com|PR Noticias
elpublicista.es|El Publicista
controlpublicidad.com|Control Publicidad
anuncios.com|Anuncios
expansion.com|Expansion
cincodias.elpais.com|Cinco Dias
palco23.com|Palco23
marketingnews.es|MarketingNews
horizont.net|Horizont
wuv.de|W&V
kress.de|kress
absatzwirtschaft.de|absatzwirtschaft
handelsblatt.com|Handelsblatt
meedia.de|Meedia
textilwirtschaft.de|TextilWirtschaft
lebensmittelzeitung.net|Lebensmittel Zeitung
strategies.fr|Strategies
cbnews.fr|CB News
e-marketing.fr|e-marketing.fr
lsa-conso.fr|LSA
fashionnetwork.fr|FashionNetwork FR
lesechos.fr|Les Echos
influencia.net|INfluencia
adformatie.nl|Adformatie
marketingtribune.nl|MarketingTribune
emerce.nl|Emerce
resume.se|Resume
dagensmedia.se|Dagens Media
kampanje.com|Kampanje
markedsforing.dk|Markedsforing
marketing.ie|Marketing.ie
adworld.ie|Adworld
irishtimes.com|The Irish Times
mediapanorama.gr|Media Panorama
marketer.pt|Marketeer
briefing.pt|Briefing
m-online.at|Medianet
horizont.at|Horizont AT
persoenlich.com|persoenlich.com
werbewoche.ch|Werbewoche
`,
  regional_apac: `
mumbrella.asia|Mumbrella Asia
marketingmag.com.sg|Marketing Singapore
adasia.com|AdAsia
advertimes.com|AdverTimes
senden-kaigi.co.jp|Sendenkaigi
nikkeibp.co.jp|Nikkei BP
oricon.co.jp|Oricon
koreaherald.com|The Korea Herald
koreajoongangdaily.joins.com|Korea JoongAng Daily
soompi.com|Soompi
allkpop.com|allkpop
yna.co.kr|Yonhap
businessoffashion.cn|BoF China
jingdaily.cn|Jing Daily China
digitalcrew.com.au|Digital Crew
storyboard18.com|Storyboard18
campaignindia.in|Campaign India
bestmediainfo.com|BestMediaInfo
socialsamosa.com|Social Samosa
medianews4u.com|MediaNews4U
thehindubusinessline.com|BusinessLine
stuff.co.nz|Stuff
nzherald.co.nz|NZ Herald
stoppress.co.nz|StopPress
`,
  regional_americas_mea: `
meioemensagem.com.br|Meio & Mensagem
propmark.com.br|Propmark
adnews.com.br|Adnews Brasil
exame.com|Exame
valor.globo.com|Valor Economico
merca20.com|Merca2.0
expansion.mx|Expansion MX
latamsports.com|LatAm Sports
latinspots.com|Latin Spots
adlatina.com|Adlatina
lanacion.com.ar|La Nacion
campaignme.com|Campaign Middle East
communicateonline.me|Communicate
arabianbusiness.com|Arabian Business
gulfnews.com|Gulf News
thenationalnews.com|The National
bizcommunity.com|Bizcommunity
marklives.com|MarkLives
techcabal.com|TechCabal
businessday.ng|BusinessDay
brandcrunch.com.ng|BrandCrunch
marketingedge.com.ng|Marketing Edge
nairametrics.com|Nairametrics
thisdaylive.com|ThisDay
punchng.com|Punch
`,
};

export const SOURCES: Source[] = (Object.entries(RAW) as [SourceGroup, string][]).flatMap(([group, text]) =>
  text.trim().split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const [domain, name] = l.split("|");
    return { domain: domain.toLowerCase(), name: name ?? domain, group };
  }));

/** Which source groups matter for a company, from its Qloo type and taste tags. Wires, marketing, PR, business, conferences and awards always apply. */
const INDUSTRIES: { words: string; groups: SourceGroup[] }[] = [
  { words: "films?|studios?|tv|television|series|streaming|cinema|movies?", groups: ["film_tv", "media_business", "talent"] },
  { words: "music|records?|labels?|hip hop|rap|pop|rock|indie|r&b|country|singers?|bands?", groups: ["music", "live", "talent"] },
  { words: "sports?|football|soccer|basketball|clubs?|leagues?|racing|athletes?|athletics|fc", groups: ["sports", "talent"] },
  { words: "fashion|apparel|clothing|luxury|eyewear|sunglasses|footwear|shoes?|sneakers?|streetwear|couture|designer", groups: ["fashion", "retail", "luxury_travel"] },
  { words: "beauty|cosmetics?|skincare|makeup|fragrances?|perfumes?", groups: ["beauty", "fashion", "retail"] },
  { words: "drinks?|beverages?|soda|water|energy drinks?|coffee|food|snacks?|restaurants?", groups: ["food_bev", "retail"] },
  { words: "beer|wine|spirits|whiske?y|vodka|tequila|gin|rum", groups: ["drinks", "food_bev"] },
  { words: "games?|gaming|esports?|video ?games?", groups: ["gaming", "tech"] },
  { words: "cars?|auto|automotive|automobiles?|vehicles?|motors?|supercars?", groups: ["auto", "luxury_travel"] },
  { words: "tech|technology|apps?|software|learning|edtech|internet", groups: ["tech"] },
  { words: "hotels?|travel|tourism|airlines?", groups: ["luxury_travel"] },
];

/**
 * Which source groups matter for a company. Each industry scores one point per Qloo tag that names it
 * (whole words only, so "skincare" is not "car"); an industry counts if it scores at least 40% of the top
 * one, so a fashion house with one "Red Carpet Events" tag doesn't pull in the film trade press.
 * Industry groups come first, strongest first; marketing, PR, wires, business press and registries always apply.
 */
export function groupsFor(type: string, tags: string[] = [], hq: string | null = null): SourceGroup[] {
  const lower = tags.map(x => x.toLowerCase());
  const scores = INDUSTRIES.map(ind => {
    const re = new RegExp(`\\b(${ind.words})\\b`);
    return { ind, score: lower.filter(x => re.test(x)).length };
  });
  if (type === "movie" || type === "tv_show") scores[0].score += 5;
  if (type === "artist") scores[1].score += 5;
  const top = Math.max(...scores.map(x => x.score));
  const g = new Set<SourceGroup>();
  if (top > 0) for (const { ind } of scores.filter(x => x.score >= Math.max(1, top * 0.4)).sort((a, b) => b.score - a.score)) ind.groups.forEach(x => g.add(x));
  else ["retail", "media_business"].forEach(x => g.add(x as SourceGroup));
  // Regional press only from where the company is: its HQ, or tags like "Companies based in Milan" / "Clothing brands of Italy".
  const where = `${hq ?? ""} ${lower.filter(x => /\b(based in|brands of|companies of|established in)\b/.test(x)).join(" ")}`.toLowerCase();
  if (/\b(ital(y|ian)|milan|rome|madrid|barcelona|spain|spanish|paris|france|french|berlin|germany|german|london|amsterdam|europe|bologna|munich)\b/.test(where)) g.add("regional_eu");
  if (/\b(tokyo|japan|seoul|korea|shanghai|beijing|china|mumbai|india|singapore|sydney|australia|hong kong)\b/.test(where)) g.add("regional_apac");
  if (/\b(brazil|s.o paulo|mexico|argentina|nigeria|lagos|dubai|uae|south africa|kenya)\b/.test(where)) g.add("regional_americas_mea");
  ["marketing", "pr", "conference", "awards", "wire", "business", "registry"].forEach(x => g.add(x as SourceGroup));
  return [...g];
}
