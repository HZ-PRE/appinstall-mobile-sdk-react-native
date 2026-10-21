#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <CommonCrypto/CommonDigest.h>

@interface AppInstallAttribution : NSObject <RCTBridgeModule>
@end
@implementation AppInstallAttribution
RCT_EXPORT_MODULE(AppInstallAttribution)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSURL *)file:(NSString *)scope error:(NSError **)error {
  if (!scope || scope.length > 4096) return nil;
  NSData *data = [scope dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *name = [NSMutableString string];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [name appendFormat:@"%02x", digest[i]];
  NSURL *root = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask] firstObject];
  NSURL *directory = [root URLByAppendingPathComponent:@"AppInstallRN" isDirectory:YES];
  if (![[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:error]) return nil;
  if (![directory setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:error]) return nil;
  return [directory URLByAppendingPathComponent:[name stringByAppendingString:@".json"]];
}
RCT_EXPORT_METHOD(readState:(NSString *)scope resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil; NSURL *file = [self file:scope error:&error];
  if (!file) { reject(@"INSTALL_IO", @"Installation state unavailable", nil); return; }
  NSData *data = [NSData dataWithContentsOfURL:file options:0 error:&error];
  if (!data && error.code == NSFileReadNoSuchFileError) { resolve([NSNull null]); return; }
  NSString *text = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  if (!text) { reject(@"INSTALL_IO", @"Cannot read installation state", nil); return; }
  resolve(text);
}
RCT_EXPORT_METHOD(writeState:(NSString *)scope value:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil; NSURL *file = [self file:scope error:&error];
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (!file || data.length > 262144 || ![data writeToURL:file options:NSDataWritingAtomic | NSDataWritingFileProtectionCompleteUntilFirstUserAuthentication error:&error] || ![file setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:&error]) {
    reject(@"INSTALL_IO", @"Cannot persist installation state", nil); return;
  }
  resolve([NSNull null]);
}
RCT_EXPORT_METHOD(clearState:(NSString *)scope resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil; NSURL *file = [self file:scope error:&error];
  if (!file || (![[NSFileManager defaultManager] removeItemAtURL:file error:&error] && error.code != NSFileNoSuchFileError)) { reject(@"INSTALL_IO", @"Cannot clear installation state", nil); return; }
  resolve([NSNull null]);
}
RCT_EXPORT_METHOD(newInstanceId:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve([NSUUID UUID].UUIDString.lowercaseString); }
RCT_EXPORT_METHOD(getTimezone:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve([NSTimeZone localTimeZone].name); }
RCT_EXPORT_METHOD(readClipboard:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if ([UIApplication sharedApplication].applicationState != UIApplicationStateActive) { reject(@"BACKGROUND", @"Clipboard requires foreground", nil); return; }
  NSString *text = [UIPasteboard generalPasteboard].string;
  resolve(text && text.length <= 8192 ? text : [NSNull null]);
}
RCT_EXPORT_METHOD(readPackageSource:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve([NSNull null]); }
RCT_EXPORT_METHOD(readReferrer:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve(@{@"status": @"unavailable"}); }
@end
