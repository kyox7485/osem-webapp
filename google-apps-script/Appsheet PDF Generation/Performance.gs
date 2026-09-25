function logElapsed(label, startTime){

  const elapsed =
      new Date().getTime() - startTime;

  Logger.log(
      label +
      " : " +
      elapsed +
      " ms"
  );

}