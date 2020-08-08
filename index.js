const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3')
const open = require('sqlite').open;

async function getUrls(page) {
    await page.goto('https://www.hltv.org/results');
    let result = [];
    for (let i=0; i<4; i++) {
        const pages = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('div.result-con > a'), e => e.href);
        });
        result = result.concat(pages);
        await page.evaluate(() => {
            return document.querySelector('a.pagination-next').click();
        });
        await page.waitForNavigation();
    }
    return result;
}

async function getMaps(page) {
    const multipleMaps = await page.evaluate(() => {
        return document.querySelector('div.columns');
    })
    if (!multipleMaps) {
        return false;
    }
    return page.evaluate(() => {
        return Array.from(document.querySelector('div.columns').querySelectorAll('a.inactive'), e => e.href);
    })
}

async function getRoundHistoryStats(page) {
    const stats = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.round-history-outcome'), e => e.src);
    })
    return [
        getRoundStatistics(stats.slice(0, 30)),
        getRoundStatistics(stats.slice(30, 60))
    ]

}

function getRoundStatistics(stats) {
    const result = {
        eliminationWins: 0,
        terroristsWins: 0,
        ctsWins: 0,
        defuses: 0,
        explodes: 0,
    }
    for (const stat of stats) {
        if (stat.includes('ct_win')) {
            result.ctsWins++;
            result.eliminationWins++;
        } else if (stat.includes('stopwatch')) {
            result.ctsWins++;
        } else if (stat.includes('t_win')) {
            result.terroristsWins++;
            result.eliminationWins++;
        } else if (stat.includes('exploded')) {
            result.explodes++;
            result.terroristsWins++;
        } else if (stat.includes('defused')) {
            result.defuses++;
            result.ctsWins++;
        }
    }
    return result;
}

async function getPlayersStats(page) {
    const stats = {
        kills: 'td.st-kills',
        assists: 'td.st-assists',
        deaths: 'td.st-deaths',
    };

    const results = [{}, {}]

    for (const [key, cssClass] of Object.entries(stats)) {
        const stat = await getOneStat(page, cssClass);
        results[0][key] = stat.slice(0, 5).reduce((a, b) => a + b, 0)
        results[1][key] = stat.slice(5, 10).reduce((a, b) => a + b, 0)
    }

    return results;

}

async function getOneStat(page, cssClass) {
    return page.evaluate((cssClass) => {
        return Array.from(document.querySelectorAll(cssClass), e => parseInt(e.innerText));
    }, cssClass)
}

async function getEconomyStats(page) {
    const url = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.stats-top-menu-item'), e => e.href)[2];
    })
    await page.goto(url);
    const stats = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img.equipment-category'), e => e.src)
    })
    const results = Array.from({length: 2}).fill(0).map(() => ({
        pistolWin: 0,
        ecoWin: 0,
        forceWin: 0,
        fullWin: 0,
    }))
    stats.forEach((value, index) => {
        let update = 1;
        const secondHalfIndex = (stats.length - 30) / 2
        if (index < 15 || (index  >= 30 && index < 30 + secondHalfIndex)) {
            update = 0;
        }
        if (value.includes('ForcePistolWin')) {
            results[update].ecoWin++;
        } else if (value.includes('PistolWin')) {
            results[update].pistolWin++;
        } else if (value.includes('ForcebuyWin')) {
            results[update].forceWin++;
        } else if (value.includes('RifleArmorWin')) {
            results[update].fullWin++;
        }
    })
    return results;
}

async function getDetailedStats(urls, page) {
    if (urls) {
        const stats = [];
        for (const url of urls) {
            await page.goto(url);
            stats.push(await getOneMapDetailedStats(page));
        }
        return stats;
    } else {
        return [await getOneMapDetailedStats(page)]
    }
}

async function getMapScore(page) {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll('div.bold'), node => Number(node.innerText)).slice(0, 2);
    });
}

async function getOneMapDetailedStats(page) {
    const scores = await getMapScore(page);
    const rounds = scores[0] + scores[1];
    const entryKills = await getEntryKills(page);
    const map = await getMapName(page);
    const roundHistory = await getRoundHistoryStats(page);
    const playerStats = await getPlayersStats(page);
    const economy = await getEconomyStats(page);
    return {
        scores,
        rounds,
        entryKills,
        map,
        roundHistory,
        playerStats,
        economy,
    }
}

async function getEntryKills(page) {
    return page.evaluate(() => {
        return Array.from(document.querySelector('div.match-info-box-con').querySelectorAll('.right'), node => node.innerText.split(' : '))[2];
    });
}

async function getMapName(page) {
    return page.evaluate(() => {
        return document.querySelector('div.match-info-box').innerText.split('\n')[4]
    });
}

async function scrapMatch(page, url) {
    await page.goto(url);

    const teamNames = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div.teamName'), node => node.innerText);
    });

    const teamRanks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div.teamRanking'), node => Number(node.innerText.split('#').pop().replace('Unranked', '400')));
    });

    const unixDate = await page.evaluate(() => {
        return parseInt(document.querySelector('div.date').getAttribute('data-unix'));
    });

    const detailedUrl = await page.evaluate(() => {
        return document.querySelector('div.stats-detailed-stats').querySelector('a').href;
    });

    await page.goto(detailedUrl);

    const maps = await getMaps(page, detailedUrl);

    const stats = await getDetailedStats(maps, page)

    return {
        url,
        teamNames,
        teamRanks,
        unixDate,
        stats,
    }

}

async function createRecord(db, data, stat, first, second) {
    await db.run(`
                    INSERT INTO results (url, teamOneName, teamOneRank, teamTwoName, teamTwoRank, 
                    map, matchTime, teamRankDifference, killsPerRoundDifference,
                    deathsPerRoundDifference, assistsPerRoundDifference, entryKillsPerRoundDifference, 
                    explodesPerRoundDifference, defusesPerRoundDifference, eliminationsPerRoundDifference,
                    pistolWinDifference, ecoWinDifference, forceWinDifference, fullWinDifference, teamOneWinner) VALUES
                    (:url, :teamOneName, :teamOneRank, :teamTwoName, :teamTwoRank, :map, :matchTime, :teamRankDifference, :killsPerRoundDifference,
                    :deathsPerRoundDifference, :assistsPerRoundDifference, :entryKillsPerRoundDifference,
                    :explodesPerRoundDifference, :defusesPerRoundDifference, :eliminationsPerRoundDifference,
                    :pistolWinDifference, :ecoWinDifference, :forceWinDifference, :fullWinDifference, :teamOneWinner)
                `, {
        ':url': data.url,
        ':teamOneName': data.teamNames[first],
        ':teamOneRank': data.teamRanks[first],
        ':teamTwoName': data.teamNames[second],
        ':teamTwoRank': data.teamRanks[second],
        ':map': stat.map,
        ':matchTime': data.unixDate,
        ':teamRankDifference': data.teamRanks[first] - data.teamRanks[second],
        ':killsPerRoundDifference': stat.playerStats[first].kills - stat.playerStats[second].kills,
        ':deathsPerRoundDifference': stat.playerStats[first].deaths - stat.playerStats[second].deaths,
        ':assistsPerRoundDifference': stat.playerStats[first].assists - stat.playerStats[second].assists,
        ':entryKillsPerRoundDifference': stat.entryKills[first] - stat.entryKills[second],
        ':explodesPerRoundDifference': stat.roundHistory[first].explodes / stat.rounds - stat.roundHistory[second].explodes / stat.rounds,
        ':defusesPerRoundDifference': stat.roundHistory[first].defuses / stat.rounds - stat.roundHistory[second].defuses / stat.rounds,
        ':eliminationsPerRoundDifference': stat.roundHistory[first].eliminationWins / stat.rounds - stat.roundHistory[second].eliminationWins / stat.rounds,
        ':pistolWinDifference': stat.economy[first].pistolWin - stat.economy[second].pistolWin,
        ':ecoWinDifference': stat.economy[first].ecoWin / stat.rounds - stat.economy[second].ecoWin / stat.rounds,
        ':forceWinDifference': stat.economy[first].forceWin / stat.rounds - stat.economy[second].forceWin / stat.rounds,
        ':fullWinDifference': stat.economy[first].fullWin / stat.rounds - stat.economy[second].fullWin / stat.rounds,
        ':teamOneWinner': stat.scores[first] > stat.scores[second]
    })
}

async function scrap() {
    const db = await open({
        filename: 'database.db',
        driver: sqlite3.Database
    })

    await db.exec(`
        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            teamOneName TEXT NOT NULL,
            teamOneRank INTEGER NOT NULL,
            teamTwoName TEXT NOT NULL,
            teamTwoRank INTEGER NOT NULL,
            map TEXT NOT NULL,
            matchTime TIMESTAMP NOT NULL,
            teamRankDifference INTEGER NOT NULL,
            killsPerRoundDifference REAL NOT NULL,
            deathsPerRoundDifference REAL NOT NULL,
            assistsPerRoundDifference REAL NOT NULL,
            entryKillsPerRoundDifference REAL NOT NULL,
            explodesPerRoundDifference REAL NOT NULL,
            defusesPerRoundDifference REAL NOT NULL,
            eliminationsPerRoundDifference REAL NOT NULL,
            pistolWinDifference REAL NOT NULL,
            ecoWinDifference REAL NOT NULL,
            forceWinDifference REAL NOT NULL,
            fullWinDifference REAL NOT NULL,
            teamOneWinner INTEGER NOT NULL, 
            UNIQUE(url, teamOneName, teamTwoName, map) ON CONFLICT REPLACE
        );
    `)
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const urls = await getUrls(page);
    for (const url of urls) {
        try {
            const data = await scrapMatch(page, url);
            for (const stat of data.stats) {
                await createRecord(db, data, stat, 0, 1)
                await createRecord(db, data, stat, 1, 0)
            }
        } catch (err) {
            //Forfeits etc.
            console.log(`Error: ${url}`);
        }

    }
    await browser.close();

}


async function main() {
    await scrap();
}

main();