@Entry
@Component
struct Index {
  build() {
    Column({ space: 14 }) {
      Text('Mobile Automation Stream')
        .fontSize(22)
        .fontWeight(FontWeight.Medium)
        .fontColor('#14213D')

      Text('Listening on device port 28282')
        .fontSize(15)
        .fontColor('#4A5568')

      Text('Keep this app open while the desktop agent is connected.')
        .fontSize(13)
        .fontColor('#718096')
        .textAlign(TextAlign.Center)
        .width('82%')
    }
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .height('100%')
    .width('100%')
    .backgroundColor('#F7FAFC')
  }
}
