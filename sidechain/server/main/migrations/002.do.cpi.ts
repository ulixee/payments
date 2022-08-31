import config from '../../config';

export function generateSql(): string {
  return `INSERT INTO CONSUMER_PRICE_INDEX ("date",value,conversion_rate) VALUES ('${config.cpiBaseline.date}', ${config.cpiBaseline.value}, 1)`;
}
