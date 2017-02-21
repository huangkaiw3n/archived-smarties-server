var _ = require('lodash');
var moment = require('moment');

module.exports = {
  toProperCase: (string) => {
      return string.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
  },
  writeToFile: (filename, content) => {
    fs.writeFile(filename, content, (err) => {
      if (err) throw err;
      console.log("File " + filename + " written successfully. \n")
    });
  },
  calculateParkingSession: (startTimestamp, duration, rateCodes, dayCap) => {
    // Current algo does not take into account there are rates with overlapping blocks
    // 1. Find current moment belongs to which rate block?
    // 2. Find minimium of current moment + duration vs current block end time.
    // 3. Take time from current moment to 2. as the accountedDuration
    // 4. Calculate price based on rates for the accountedDuration
    // 5. Add price and accountedDuration to totalPrice and chargedDuration
    // 6. Repeat until either chargedDuration === duration or no rate block is found

    let chargedDuration = 0;
    let totalPrice = 0; //in cents!
    let accumulatedDayPrice = 0;

    // TODO THIS IS CURRENT TIME HACK! TO REMOVE
    let now = startTimestamp;
    // let now = 1485563400000;
    let startMoment = moment(now);
    let endMoment = moment(now);
    let remainingDuration = duration;
    let currentMoment = moment(now);

    let startDayBlock = moment(now).set({
      "hour": '07',
      "minute": '00',
      second: '00',
      millisecond: '000'
    });

    if (now < startDayBlock) { // this accounts if now is AM
      startDayBlock.subtract(1, 'days');
    }
    let endDayBlock = moment(startDayBlock).add(1, 'days');

    while (remainingDuration > 0) {
      let currentRateDay = currentMoment.isoWeekday();
      let rateBlockStart;
      let rateBlockEnd;
      let currentRateBlock = _(rateCodes).filter((r) => currentRateDay >= r.start_day_of_week && currentRateDay <= r.end_day_of_week)
                                          .find((r) => {
                                            let [start_hour, start_minute] = r.start_time.split(':');
                                            let [end_hour, end_minute] = r.end_time.split(':');
                                            // '[)' indicates an inclusive start and exclusive end
                                            rateBlockStart = moment(currentMoment).set({
                                              "hour": start_hour,
                                              "minute": start_minute,
                                              second: '00',
                                              millisecond: '000'
                                            });
                                            rateBlockEnd = moment(currentMoment).set({
                                              "hour": end_hour,
                                              "minute": end_minute,
                                            });
                                            if (rateBlockEnd < rateBlockStart) { // this accounts for overnight blocks
                                              if (currentMoment.format('A') === "AM") {
                                                rateBlockStart.subtract(1, 'days');
                                              } else {
                                                rateBlockEnd.add(1, 'days');
                                              }
                                            }
                                            return currentMoment.isBetween(
                                              rateBlockStart,
                                              rateBlockEnd,
                                              null,
                                              '[)'
                                            );
                                          });
      if (!currentRateBlock) break;
      let currentRateInCentsPerMin = currentRateBlock.parking_block_duration ?
                              currentRateBlock.parking_rate * 100 / currentRateBlock.parking_block_duration : 0;
      let accountedDuration = _.min([
                              moment(currentMoment).add(remainingDuration),
                              rateBlockEnd
                            ]) - currentMoment;
      let accountedPrice = (Math.ceil(accountedDuration / 60000) * currentRateInCentsPerMin);
      if (currentRateBlock.price_cap && accountedPrice > currentRateBlock.price_cap * 100) {
        accountedPrice = currentRateBlock.price_cap * 100;
      }
      accumulatedDayPrice = accumulatedDayPrice + accountedPrice;
      chargedDuration = chargedDuration + accountedDuration;
      currentMoment.add(accountedDuration);
      remainingDuration = remainingDuration - accountedDuration;

      if (dayCap && currentMoment >= endDayBlock) {
        totalPrice = totalPrice + _.min([accumulatedDayPrice, dayCap * 100]);
        accumulatedDayPrice = 0;
        startDayBlock.add(1, 'days');
        endDayBlock.add(1, 'days');
      }
      console.log(`accumulatedDayPrice: ${accumulatedDayPrice}`);
      console.log(`chargedDuration: ${chargedDuration}`);
      console.log(`totalPrice: ${totalPrice}`);
    }

    if (dayCap) {
      totalPrice = totalPrice + _.min([accumulatedDayPrice, dayCap * 100]);
    } else {
      totalPrice = totalPrice + accumulatedDayPrice;
    }
    return [startMoment, endMoment.add(chargedDuration), chargedDuration, Math.ceil(totalPrice)];
  }
}
