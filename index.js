const {Client} = require('pg');
const puppeteer = require('puppeteer');

const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: 'postgres',
    port: 5432,
});

const createQuery = `
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  download_url varchar(255) NOT NULL UNIQUE,
  match_url varchar(255) NOT NULL UNIQUE,
  team_one varchar(255) NOT NULL,
  team_two varchar(255) NOT NULL,
  team_one_rank varchar(255) NOT NULL,
  team_two_rank varchar(255) NOT NULL,
  status BOOLEAN DEFAULT FALSE,
  datetime TIMESTAMP NOT NULL
)`;


async function scrap() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('https://www.hltv.org/results?content=demo');
    const urls = await page.evaluate(() => {
        return Array.from(document.querySelector('div.results-all').querySelectorAll('a.a-reset'), e => e.href);
    });
    for (const url of urls) {
        await page.goto(url);
        const demoUrl = await page.evaluate(() => {
            return document.querySelector('.flexbox.left-right-padding').href;
        });
        const teamNames = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('div.teamName'), node => node.innerText);
        });

        const teamRanks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('div.teamRanking'), node => node.innerText.split('#').pop());
        });

        const unixDate = await page.evaluate(() => {
            return parseInt(document.querySelector('div.date').getAttribute('data-unix'));
        });

        const insertQuery = `
        INSERT INTO matches (download_url, match_url, team_one, team_two, team_one_rank, team_two_rank, datetime)
        VALUES ('${demoUrl}', '${url}', '${teamNames[0]}', '${teamNames[1]}', '${teamRanks[0]}', '${teamRanks[1]}', TO_TIMESTAMP(${unixDate}));
        `;

        console.log(insertQuery);

        client.query(insertQuery).catch(e => console.log(e));
    }
    await browser.close();
}


async function main() {
    client.connect();
    client.query(createQuery);
    await scrap();
    client.end();
}

main();