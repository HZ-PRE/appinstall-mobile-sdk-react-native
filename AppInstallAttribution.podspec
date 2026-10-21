require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'AppInstallAttribution'
  s.version = package['version']
  s.summary = 'AppInstall installation state and credential bridge.'
  s.homepage = 'https://appinstall.com'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'AppInstall'
  s.source = { :path => '.' }
  s.platform = :ios, '15.1'
  s.source_files = 'ios/**/*.{h,m,mm}'
  s.dependency 'React-Core'
end
